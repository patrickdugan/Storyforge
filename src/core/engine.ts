/**
 * StoryForge - Simulation Engine
 * 
 * Orchestrates multi-agent narrative simulations with:
 * - Epistemic isolation (agents can't see each other's views)
 * - Storyworld-mediated interaction (no direct backchannel)
 * - Session tracking for SAE analysis
 */

import { v4 as uuid } from 'uuid';
import {
  Simulation,
  SimulationStatus,
  SimulationEvent,
  AgentSlot,
  Frame,
  FrameStage,
  StateSnapshot,
  AgentProfile
} from '../core/types.js';
import {
  Storyworld,
  AgentView,
  Encounter,
  Choice,
  SpoolProgress,
  VariableState,
  SessionOutcome,
  NarrativeEvent,
  Gate,
  GateCondition,
  VariableMutation
} from '../narrative/types.js';

// ============================================================================
// Engine Configuration
// ============================================================================

export interface EngineConfig {
  /** Maximum frames before forced end */
  maxFrames?: number;
  /** Timeout for agent responses in ms */
  agentTimeoutMs?: number;
  /** Snapshot state every N frames */
  snapshotInterval?: number;
  /** Prevent any form of backchannel between agents */
  enforceEpistemicIsolation?: boolean;
  /** Compute metrics after each frame */
  computeMetricsPerFrame?: boolean;
}

export type AgentActionHandler = (
  agentId: string,
  view: AgentView
) => Promise<{ choiceId?: string; message?: string } | null>;

export type EventHandler = (event: SimulationEvent) => void | Promise<void>;

// ============================================================================
// World State Manager
// ============================================================================

class WorldState {
  private variables: Map<string, VariableState> = new Map();
  private spoolProgress: Map<string, SpoolProgress[]> = new Map(); // agentId -> progress[]
  private frame: number = 0;

  constructor(private storyworld: Storyworld) {
    this.initializeVariables();
  }

  private initializeVariables(): void {
    for (const variable of this.storyworld.variables) {
      this.variables.set(variable.id, {
        variableId: variable.id,
        value: variable.defaultValue,
        lastModifiedFrame: 0
      });
    }
  }

  getVariable(id: string): VariableState | undefined {
    return this.variables.get(id);
  }

  setVariable(id: string, value: unknown, modifiedBy?: string): void {
    this.variables.set(id, {
      variableId: id,
      value,
      lastModifiedFrame: this.frame,
      modifiedBy
    });
  }

  applyMutation(mutation: VariableMutation, actorId: string): void {
    const current = this.getVariable(mutation.variableId);
    if (!current) return;

    let newValue: unknown;
    switch (mutation.operation) {
      case 'SET':
        newValue = mutation.value;
        break;
      case 'ADD':
        newValue = (current.value as number) + (mutation.value as number);
        break;
      case 'SUBTRACT':
        newValue = (current.value as number) - (mutation.value as number);
        break;
      case 'MULTIPLY':
        newValue = (current.value as number) * (mutation.value as number);
        break;
      case 'APPEND':
        newValue = [...(current.value as unknown[]), mutation.value];
        break;
      case 'REMOVE':
        newValue = (current.value as unknown[]).filter(v => v !== mutation.value);
        break;
      case 'TOGGLE':
        newValue = !current.value;
        break;
      default:
        newValue = mutation.value;
    }

    this.setVariable(mutation.variableId, newValue, actorId);
  }

  getAllVariables(): VariableState[] {
    return Array.from(this.variables.values());
  }

  getAgentSpools(agentId: string): SpoolProgress[] {
    return this.spoolProgress.get(agentId) ?? [];
  }

  setAgentSpools(agentId: string, progress: SpoolProgress[]): void {
    this.spoolProgress.set(agentId, progress);
  }

  advanceFrame(): void {
    this.frame++;
  }

  getCurrentFrame(): number {
    return this.frame;
  }

  snapshot(): { variables: VariableState[]; spoolProgress: Map<string, SpoolProgress[]> } {
    return {
      variables: this.getAllVariables(),
      spoolProgress: new Map(this.spoolProgress)
    };
  }
}

// ============================================================================
// Gate Evaluator
// ============================================================================

class GateEvaluator {
  constructor(private storyworld: Storyworld) {}

  evaluate(gateId: string, worldState: WorldState, agentId?: string): boolean {
    const gate = this.storyworld.gates.find(g => g.id === gateId);
    if (!gate) return true; // No gate = always open

    return this.evaluateCondition(gate.condition, worldState, agentId);
  }

  private evaluateCondition(
    condition: GateCondition,
    worldState: WorldState,
    agentId?: string
  ): boolean {
    const { operator, variableId, value, children } = condition;

    // Get variable value if needed
    let varValue: unknown;
    if (variableId) {
      const varState = worldState.getVariable(variableId);
      varValue = varState?.value;
    }

    switch (operator) {
      case 'EQ':
        return varValue === value;
      case 'NEQ':
        return varValue !== value;
      case 'GT':
        return (varValue as number) > (value as number);
      case 'GTE':
        return (varValue as number) >= (value as number);
      case 'LT':
        return (varValue as number) < (value as number);
      case 'LTE':
        return (varValue as number) <= (value as number);
      case 'CONTAINS':
        return Array.isArray(varValue) && varValue.includes(value);
      case 'NOT_CONTAINS':
        return !Array.isArray(varValue) || !varValue.includes(value);
      case 'EXISTS':
        return varValue !== undefined && varValue !== null;
      case 'NOT_EXISTS':
        return varValue === undefined || varValue === null;
      case 'AND':
        return (children ?? []).every(c => this.evaluateCondition(c, worldState, agentId));
      case 'OR':
        return (children ?? []).some(c => this.evaluateCondition(c, worldState, agentId));
      case 'NOT':
        return !(children?.[0] && this.evaluateCondition(children[0], worldState, agentId));
      default:
        return true;
    }
  }
}

// ============================================================================
// Agent View Builder (Epistemic Isolation)
// ============================================================================

class ViewBuilder {
  constructor(
    private storyworld: Storyworld,
    private gateEvaluator: GateEvaluator
  ) {}

  /**
   * Build an agent's epistemically-isolated view of the world.
   * This is what gets sent to the LLM - they cannot see anything else.
   */
  buildView(
    agentId: string,
    simulationId: string,
    worldState: WorldState,
    recentEvents: NarrativeEvent[]
  ): AgentView {
    const frame = worldState.getCurrentFrame();
    
    // Filter variables this agent can see
    const visibleVariables = this.getVisibleVariables(agentId, worldState);
    
    // Get available spools (that pass their entry gates)
    const availableSpools = this.getAvailableSpools(agentId, worldState);
    
    // Get agent's active spool progress
    const activeSpools = worldState.getAgentSpools(agentId);
    
    // Get current encounter if any
    const currentEncounter = this.getCurrentEncounter(agentId, activeSpools);
    
    // Get available choices (filtered by gates)
    const availableChoices = currentEncounter
      ? this.getAvailableChoices(currentEncounter, worldState, agentId)
      : [];
    
    // Build recent history from events this agent witnessed
    const recentHistory = this.buildRecentHistory(agentId, recentEvents);

    return {
      agentId,
      simulationId,
      frame,
      visibleVariables,
      availableSpools,
      activeSpools,
      currentEncounter,
      availableChoices,
      recentHistory
    };
  }

  private getVisibleVariables(agentId: string, worldState: WorldState): VariableState[] {
    // Only show GLOBAL and this agent's AGENT-scoped variables
    return worldState.getAllVariables().filter(v => {
      const varDef = this.storyworld.variables.find(vd => vd.id === v.variableId);
      if (!varDef) return false;
      return varDef.scope === 'GLOBAL' || varDef.scope === 'AGENT';
    });
  }

  private getAvailableSpools(
    agentId: string,
    worldState: WorldState
  ): { spoolId: string; spoolName: string; description: string }[] {
    const activeSpoolIds = new Set(
      worldState.getAgentSpools(agentId).map(p => p.spoolId)
    );

    return this.storyworld.spools
      .filter(spool => {
        // Not already active
        if (activeSpoolIds.has(spool.id)) return false;
        // Gate passes
        if (spool.entryGateId && !this.gateEvaluator.evaluate(spool.entryGateId, worldState, agentId)) {
          return false;
        }
        return true;
      })
      .map(spool => ({
        spoolId: spool.id,
        spoolName: spool.name,
        description: spool.description
      }));
  }

  private getCurrentEncounter(
    agentId: string,
    activeSpools: SpoolProgress[]
  ): Encounter | undefined {
    for (const progress of activeSpools) {
      if (progress.currentEncounterId) {
        const encounter = this.storyworld.encounters.find(
          e => e.id === progress.currentEncounterId
        );
        if (encounter) return encounter;
      }
    }
    return undefined;
  }

  private getAvailableChoices(
    encounter: Encounter,
    worldState: WorldState,
    agentId: string
  ): Choice[] {
    return encounter.choices.filter(choice => {
      if (!choice.gateId) return true;
      return this.gateEvaluator.evaluate(choice.gateId, worldState, agentId);
    });
  }

  private buildRecentHistory(
    agentId: string,
    events: NarrativeEvent[]
  ): { frame: number; event: string; summary: string }[] {
    return events
      .filter(e => e.agentId === agentId || !e.agentId) // Own events or global
      .slice(-10) // Last 10
      .map(e => ({
        frame: e.frame,
        event: e.eventType,
        summary: this.summarizeEvent(e)
      }));
  }

  private summarizeEvent(event: NarrativeEvent): string {
    switch (event.eventType) {
      case 'CHOICE_MADE':
        return `Made choice in ${event.encounterId}`;
      case 'SPOOL_ENTERED':
        return `Entered narrative thread: ${event.spoolId}`;
      case 'SPOOL_COMPLETED':
        return `Completed narrative thread: ${event.spoolId}`;
      case 'VARIABLE_CHANGED':
        return `World state changed: ${event.variableId}`;
      default:
        return event.eventType;
    }
  }
}

// ============================================================================
// Simulation Engine
// ============================================================================

export class SimulationEngine {
  private simulation: Simulation;
  private storyworlds: Map<string, Storyworld> = new Map();
  private worldStates: Map<string, WorldState> = new Map();
  private gateEvaluators: Map<string, GateEvaluator> = new Map();
  private viewBuilders: Map<string, ViewBuilder> = new Map();
  private eventHandlers: EventHandler[] = [];
  private events: SimulationEvent[] = [];
  private config: Required<EngineConfig>;

  // Session tracking for SAE
  private sessionData: Map<string, {
    startFrame: number;
    choices: SessionOutcome['choiceSequence'];
  }> = new Map();

  constructor(config: EngineConfig = {}) {
    this.config = {
      maxFrames: config.maxFrames ?? 1000,
      agentTimeoutMs: config.agentTimeoutMs ?? 30000,
      snapshotInterval: config.snapshotInterval ?? 10,
      enforceEpistemicIsolation: config.enforceEpistemicIsolation ?? true,
      computeMetricsPerFrame: config.computeMetricsPerFrame ?? false
    };

    this.simulation = this.createEmptySimulation();
  }

  // --------------------------------------------------------------------------
  // Setup
  // --------------------------------------------------------------------------

  /**
   * Load storyworld(s) for simulation.
   */
  loadStoryworld(storyworld: Storyworld): void {
    this.storyworlds.set(storyworld.id, storyworld);
    this.worldStates.set(storyworld.id, new WorldState(storyworld));
    
    const gateEval = new GateEvaluator(storyworld);
    this.gateEvaluators.set(storyworld.id, gateEval);
    this.viewBuilders.set(storyworld.id, new ViewBuilder(storyworld, gateEval));
  }

  /**
   * Create a new simulation.
   */
  createSimulation(
    name: string,
    storyworldIds: string[],
    agents: Omit<AgentSlot, 'simulationId' | 'joinedAtFrame'>[],
    experimentId?: string
  ): Simulation {
    const simId = uuid();

    this.simulation = {
      id: simId,
      experimentId,
      name,
      storyworldIds,
      agents: agents.map(a => ({
        ...a,
        simulationId: simId,
        joinedAtFrame: 0
      })),
      status: 'INITIALIZING',
      currentFrame: 0,
      config: this.config,
      metadata: {}
    };

    // Initialize session tracking for each agent
    for (const agent of this.simulation.agents) {
      this.sessionData.set(agent.id, {
        startFrame: 0,
        choices: []
      });
    }

    this.emitEvent('SYSTEM', 'SIMULATION_CREATED', {
      name,
      storyworldIds,
      agentCount: agents.length
    });

    return this.simulation;
  }

  /**
   * Start the simulation.
   */
  start(): void {
    if (this.simulation.status !== 'INITIALIZING') {
      throw new Error(`Cannot start simulation in ${this.simulation.status} status`);
    }

    this.simulation.status = 'RUNNING';
    this.simulation.startedAt = new Date();

    this.emitEvent('SYSTEM', 'SIMULATION_STARTED', {});
  }

  // --------------------------------------------------------------------------
  // Frame Execution
  // --------------------------------------------------------------------------

  /**
   * Execute a single frame with agent action handler.
   */
  async executeFrame(actionHandler: AgentActionHandler): Promise<void> {
    if (this.simulation.status !== 'RUNNING') {
      throw new Error('Simulation not running');
    }

    const frame = this.simulation.currentFrame;

    // OBSERVATION: Build views for each agent
    const agentViews = new Map<string, AgentView>();
    for (const agent of this.simulation.agents) {
      if (!agent.isActive) continue;

      const view = this.buildAgentView(agent.id);
      agentViews.set(agent.id, view);

      this.emitEvent('SYSTEM', 'VIEW_DELIVERED', {
        agentId: agent.id,
        hasEncounter: !!view.currentEncounter,
        choiceCount: view.availableChoices.length
      }, agent.id);
    }

    // ACTION: Collect agent choices
    const actions = new Map<string, { choiceId?: string; message?: string }>();
    
    for (const agent of this.simulation.agents) {
      if (!agent.isActive) continue;

      const view = agentViews.get(agent.id);
      if (!view) continue;

      try {
        const action = await Promise.race([
          actionHandler(agent.id, view),
          new Promise<null>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), this.config.agentTimeoutMs)
          )
        ]);

        if (action) {
          actions.set(agent.id, action);
        }
      } catch (error) {
        this.emitEvent('SYSTEM', 'AGENT_ERROR', {
          agentId: agent.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        }, agent.id);
      }
    }

    // RESOLUTION: Process all actions
    for (const [agentId, action] of actions) {
      if (action.choiceId) {
        this.processChoice(agentId, action.choiceId);
      }
      if (action.message) {
        // Messages go through narrative channels, not direct
        this.emitEvent('COMMUNICATION', 'MESSAGE_SENT', {
          content: action.message,
          channel: 'NARRATIVE'
        }, agentId);
      }
    }

    // TRANSITION: Advance world state
    for (const worldState of this.worldStates.values()) {
      worldState.advanceFrame();
    }
    this.simulation.currentFrame++;

    // Check completion
    if (this.simulation.currentFrame >= this.config.maxFrames) {
      this.complete('Max frames reached');
    }

    // Snapshot if interval
    if (this.config.snapshotInterval > 0 && 
        this.simulation.currentFrame % this.config.snapshotInterval === 0) {
      this.takeSnapshot();
    }
  }

  /**
   * Build epistemically-isolated view for an agent.
   */
  private buildAgentView(agentId: string): AgentView {
    // Use first storyworld for now (multi-storyworld is future work)
    const storyworldId = this.simulation.storyworldIds[0];
    const viewBuilder = this.viewBuilders.get(storyworldId);
    const worldState = this.worldStates.get(storyworldId);

    if (!viewBuilder || !worldState) {
      throw new Error('Storyworld not loaded');
    }

    // Get recent events for this agent
    const recentEvents = this.events
      .filter(e => e.actorId === agentId || !e.actorId)
      .slice(-20) as unknown as NarrativeEvent[];

    return viewBuilder.buildView(
      agentId,
      this.simulation.id,
      worldState,
      recentEvents
    );
  }

  /**
   * Process an agent's choice.
   */
  private processChoice(agentId: string, choiceId: string): void {
    const storyworldId = this.simulation.storyworldIds[0];
    const storyworld = this.storyworlds.get(storyworldId);
    const worldState = this.worldStates.get(storyworldId);

    if (!storyworld || !worldState) return;

    // Find the choice
    let foundChoice: Choice | undefined;
    let foundEncounter: Encounter | undefined;

    for (const encounter of storyworld.encounters) {
      const choice = encounter.choices.find(c => c.id === choiceId);
      if (choice) {
        foundChoice = choice;
        foundEncounter = encounter;
        break;
      }
    }

    if (!foundChoice || !foundEncounter) {
      this.emitEvent('SYSTEM', 'INVALID_CHOICE', { choiceId }, agentId);
      return;
    }

    // Record choice for SAE
    const sessionData = this.sessionData.get(agentId);
    if (sessionData) {
      sessionData.choices.push({
        frame: this.simulation.currentFrame,
        encounterId: foundEncounter.id,
        choiceId: foundChoice.id,
        availableChoices: foundEncounter.choices.map(c => c.id),
        choiceIndex: foundEncounter.choices.findIndex(c => c.id === choiceId)
      });
    }

    // Apply mutations
    for (const mutation of foundChoice.mutations) {
      worldState.applyMutation(mutation, agentId);

      this.emitEvent('STATE', 'VARIABLE_CHANGED', {
        variableId: mutation.variableId,
        operation: mutation.operation,
        value: mutation.value
      }, agentId);
    }

    // Emit choice event
    this.emitEvent('NARRATIVE', 'CHOICE_MADE', {
      encounterId: foundEncounter.id,
      choiceId: foundChoice.id,
      choiceText: foundChoice.text
    }, agentId);

    // Handle narrative transitions
    if (foundChoice.isTerminal) {
      this.completeSpool(agentId, foundEncounter.spoolId);
    } else if (foundChoice.nextEncounterId) {
      this.advanceToEncounter(agentId, foundChoice.nextEncounterId);
    } else if (foundChoice.nextSpoolId) {
      this.enterSpool(agentId, foundChoice.nextSpoolId);
    }
  }

  private enterSpool(agentId: string, spoolId: string): void {
    const storyworldId = this.simulation.storyworldIds[0];
    const storyworld = this.storyworlds.get(storyworldId);
    const worldState = this.worldStates.get(storyworldId);

    if (!storyworld || !worldState) return;

    const spool = storyworld.spools.find(s => s.id === spoolId);
    if (!spool) return;

    const progress: SpoolProgress = {
      spoolId,
      agentId,
      status: 'ACTIVE',
      currentEncounterId: spool.entryEncounterId,
      enteredAtFrame: this.simulation.currentFrame,
      choiceHistory: []
    };

    const agentSpools = worldState.getAgentSpools(agentId);
    worldState.setAgentSpools(agentId, [...agentSpools, progress]);

    this.emitEvent('NARRATIVE', 'SPOOL_ENTERED', { spoolId }, agentId);
  }

  private completeSpool(agentId: string, spoolId: string): void {
    const worldState = this.worldStates.get(this.simulation.storyworldIds[0]);
    if (!worldState) return;

    const agentSpools = worldState.getAgentSpools(agentId);
    const updated = agentSpools.map(p => {
      if (p.spoolId === spoolId) {
        return { ...p, status: 'COMPLETED' as const, completedAtFrame: this.simulation.currentFrame };
      }
      return p;
    });
    worldState.setAgentSpools(agentId, updated);

    this.emitEvent('NARRATIVE', 'SPOOL_COMPLETED', { spoolId }, agentId);
  }

  private advanceToEncounter(agentId: string, encounterId: string): void {
    const worldState = this.worldStates.get(this.simulation.storyworldIds[0]);
    if (!worldState) return;

    const agentSpools = worldState.getAgentSpools(agentId);
    const updated = agentSpools.map(p => {
      if (p.status === 'ACTIVE') {
        return { ...p, currentEncounterId: encounterId };
      }
      return p;
    });
    worldState.setAgentSpools(agentId, updated);

    this.emitEvent('NARRATIVE', 'ENCOUNTER_STARTED', { encounterId }, agentId);
  }

  // --------------------------------------------------------------------------
  // Completion & Session Export
  // --------------------------------------------------------------------------

  /**
   * Complete the simulation.
   */
  complete(reason?: string): void {
    this.simulation.status = 'COMPLETED';
    this.simulation.completedAt = new Date();

    this.emitEvent('SYSTEM', 'SIMULATION_COMPLETED', { reason });
  }

  /**
   * Export session outcomes for SAE analysis.
   */
  exportSessionOutcomes(): SessionOutcome[] {
    const outcomes: SessionOutcome[] = [];

    for (const agent of this.simulation.agents) {
      const sessionData = this.sessionData.get(agent.id);
      if (!sessionData) continue;

      const worldState = this.worldStates.get(this.simulation.storyworldIds[0]);
      const agentSpools = worldState?.getAgentSpools(agent.id) ?? [];

      outcomes.push({
        sessionId: uuid(),
        agentId: agent.id,
        simulationId: this.simulation.id,
        storyworldId: this.simulation.storyworldIds[0],
        startFrame: sessionData.startFrame,
        endFrame: this.simulation.currentFrame,
        totalChoices: sessionData.choices.length,
        spoolsEntered: agentSpools.map(p => p.spoolId),
        spoolsCompleted: agentSpools.filter(p => p.status === 'COMPLETED').map(p => p.spoolId),
        endingsReached: [], // Would come from terminal encounters
        finalVariableState: worldState?.getAllVariables() ?? [],
        choiceSequence: sessionData.choices
      });
    }

    return outcomes;
  }

  // --------------------------------------------------------------------------
  // Event System
  // --------------------------------------------------------------------------

  addEventListener(handler: EventHandler): void {
    this.eventHandlers.push(handler);
  }

  private emitEvent(
    category: SimulationEvent['category'],
    eventType: string,
    payload: Record<string, unknown>,
    actorId?: string,
    targetId?: string
  ): void {
    const event: SimulationEvent = {
      id: uuid(),
      simulationId: this.simulation.id,
      frame: this.simulation.currentFrame,
      stage: 'RESOLUTION',
      category,
      eventType,
      actorId,
      targetId,
      payload,
      timestamp: new Date()
    };

    this.events.push(event);

    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (e) {
        console.error('Event handler error:', e);
      }
    }
  }

  private takeSnapshot(): StateSnapshot {
    const worldState = this.worldStates.get(this.simulation.storyworldIds[0]);
    
    return {
      id: uuid(),
      simulationId: this.simulation.id,
      frame: this.simulation.currentFrame,
      variableStates: worldState?.getAllVariables().map(v => ({
        variableId: v.variableId,
        value: v.value
      })) ?? [],
      agentStates: this.simulation.agents.map(a => ({
        agentId: a.id,
        activeSpools: worldState?.getAgentSpools(a.id).map(p => p.spoolId) ?? [],
        currentEncounter: worldState?.getAgentSpools(a.id).find(p => p.currentEncounterId)?.currentEncounterId
      })),
      createdAt: new Date()
    };
  }

  // --------------------------------------------------------------------------
  // Accessors
  // --------------------------------------------------------------------------

  getSimulation(): Simulation {
    return this.simulation;
  }

  getEvents(): SimulationEvent[] {
    return this.events;
  }

  private createEmptySimulation(): Simulation {
    return {
      id: '',
      name: '',
      storyworldIds: [],
      agents: [],
      status: 'INITIALIZING',
      currentFrame: 0,
      config: this.config
    };
  }
}
