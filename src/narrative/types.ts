/**
 * StoryForge - Narrative Types
 * 
 * Core ontology for storyworld-mediated multi-agent simulation.
 * Agents interact through narrative structures, not game orders.
 * 
 * Key concepts:
 * - Storyworld: A complete narrative environment with scenes, variables, gates
 * - Spool: A narrative thread/arc that can be entered, progressed, concluded
 * - Encounter: A discrete narrative moment with choices and outcomes
 * - Gate: A predicate that controls narrative flow based on world state
 * - AgentView: An agent's epistemically-isolated view of the storyworld
 */

import { z } from 'zod';

// ============================================================================
// Narrative Variables - The World State
// ============================================================================

/**
 * Variables track world state that gates and encounters can read/write.
 * These form the "physics" of the storyworld.
 */
export const VariableTypeSchema = z.enum([
  'NUMBER',      // Numeric value (trust level, resource count, etc.)
  'BOOLEAN',     // Binary state (alive, revealed, allied, etc.)
  'STRING',      // Categorical state (faction, mood, role, etc.)
  'SET',         // Collection of tags/flags
  'RELATION'     // Directed edge between entities (A trusts B)
]);
export type VariableType = z.infer<typeof VariableTypeSchema>;

export const VariableSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: VariableTypeSchema,
  scope: z.enum(['GLOBAL', 'AGENT', 'DYADIC', 'LOCAL']),
  defaultValue: z.unknown(),
  bounds: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
    allowedValues: z.array(z.string()).optional()
  }).optional(),
  description: z.string().optional()
});
export type Variable = z.infer<typeof VariableSchema>;

export const VariableStateSchema = z.object({
  variableId: z.string(),
  value: z.unknown(),
  lastModifiedFrame: z.number(),
  modifiedBy: z.string().optional()  // Agent or system
});
export type VariableState = z.infer<typeof VariableStateSchema>;

// ============================================================================
// Gates - Narrative Flow Control
// ============================================================================

/**
 * Gates are predicates that control what narrative options are available.
 * They read variables and return boolean availability.
 */
export const GateOperatorSchema = z.enum([
  'EQ', 'NEQ', 'GT', 'GTE', 'LT', 'LTE',  // Comparisons
  'CONTAINS', 'NOT_CONTAINS',               // Set operations
  'AND', 'OR', 'NOT',                       // Logical
  'EXISTS', 'NOT_EXISTS'                    // Existence checks
]);
export type GateOperator = z.infer<typeof GateOperatorSchema>;

export const GateConditionSchema: z.ZodType<GateCondition> = z.lazy(() =>
  z.object({
    operator: GateOperatorSchema,
    variableId: z.string().optional(),
    value: z.unknown().optional(),
    children: z.array(GateConditionSchema).optional()
  })
);
export interface GateCondition {
  operator: GateOperator;
  variableId?: string;
  value?: unknown;
  children?: GateCondition[];
}

export const GateSchema = z.object({
  id: z.string(),
  name: z.string(),
  condition: GateConditionSchema,
  description: z.string().optional()
});
export type Gate = z.infer<typeof GateSchema>;

// ============================================================================
// Encounters - Discrete Narrative Moments
// ============================================================================

/**
 * An Encounter is a narrative moment where an agent makes a choice.
 * Choices have consequences: variable mutations and narrative transitions.
 */
export const VariableMutationSchema = z.object({
  variableId: z.string(),
  operation: z.enum(['SET', 'ADD', 'SUBTRACT', 'MULTIPLY', 'APPEND', 'REMOVE', 'TOGGLE']),
  value: z.unknown(),
  targetAgent: z.string().optional()  // For AGENT/DYADIC scoped vars
});
export type VariableMutation = z.infer<typeof VariableMutationSchema>;

export const ChoiceSchema = z.object({
  id: z.string(),
  text: z.string(),                          // What the agent "says" or "does"
  gateId: z.string().optional(),             // Must pass this gate to see/choose
  mutations: z.array(VariableMutationSchema),// Effects on world state
  nextEncounterId: z.string().optional(),    // Where this leads
  nextSpoolId: z.string().optional(),        // Or which spool to enter
  isTerminal: z.boolean().optional(),        // Ends the current spool
  metadata: z.record(z.unknown()).optional() // For analysis tagging
});
export type Choice = z.infer<typeof ChoiceSchema>;

export const EncounterSchema = z.object({
  id: z.string(),
  spoolId: z.string(),
  name: z.string(),
  description: z.string(),                   // Narrative context shown to agent
  participants: z.array(z.string()),         // Which agents are in this encounter
  choices: z.array(ChoiceSchema),
  gateId: z.string().optional(),             // Gate to enter this encounter
  isEntryPoint: z.boolean().optional(),      // Can start a spool here
  isExitPoint: z.boolean().optional(),       // Can end a spool here
  timeoutChoiceId: z.string().optional(),    // Default if agent doesn't choose
  metadata: z.record(z.unknown()).optional()
});
export type Encounter = z.infer<typeof EncounterSchema>;

// ============================================================================
// Spools - Narrative Arcs/Threads
// ============================================================================

/**
 * A Spool is a coherent narrative thread - a subplot, relationship arc, 
 * or dramatic sequence that can be entered, progressed, and concluded.
 */
export const SpoolStatusSchema = z.enum([
  'AVAILABLE',   // Can be entered (gate passes)
  'ACTIVE',      // Currently being experienced
  'SUSPENDED',   // Paused, can be resumed
  'COMPLETED',   // Reached a terminal encounter
  'ABANDONED'    // Exited without completion
]);
export type SpoolStatus = z.infer<typeof SpoolStatusSchema>;

export const SpoolSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  entryGateId: z.string().optional(),        // Gate to make this spool available
  entryEncounterId: z.string(),              // Where the spool starts
  encounters: z.array(z.string()),           // Encounter IDs in this spool
  priority: z.number().optional(),           // For spool selection heuristics
  isRepeatable: z.boolean().optional(),      // Can be re-entered after completion
  tags: z.array(z.string()).optional(),      // For categorization/analysis
  metadata: z.record(z.unknown()).optional()
});
export type Spool = z.infer<typeof SpoolSchema>;

export const SpoolProgressSchema = z.object({
  spoolId: z.string(),
  agentId: z.string(),
  status: SpoolStatusSchema,
  currentEncounterId: z.string().optional(),
  enteredAtFrame: z.number(),
  completedAtFrame: z.number().optional(),
  choiceHistory: z.array(z.object({
    encounterId: z.string(),
    choiceId: z.string(),
    frame: z.number()
  }))
});
export type SpoolProgress = z.infer<typeof SpoolProgressSchema>;

// ============================================================================
// Storyworld - The Complete Narrative Environment
// ============================================================================

export const StoryworldSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  
  // Narrative structure
  variables: z.array(VariableSchema),
  gates: z.array(GateSchema),
  spools: z.array(SpoolSchema),
  encounters: z.array(EncounterSchema),
  
  // Configuration
  config: z.object({
    maxConcurrentSpools: z.number().optional(),
    defaultTimeoutFrames: z.number().optional(),
    allowSpoolInterruption: z.boolean().optional()
  }).optional(),
  
  metadata: z.record(z.unknown()).optional()
});
export type Storyworld = z.infer<typeof StoryworldSchema>;

// ============================================================================
// Agent View - Epistemically Isolated World State
// ============================================================================

/**
 * Each agent has their own view of the storyworld.
 * They cannot see other agents' views - this prevents backchanneling.
 * The AgentView is what gets passed to the LLM, not the global state.
 */
export const AgentViewSchema = z.object({
  agentId: z.string(),
  simulationId: z.string(),
  frame: z.number(),
  
  // What this agent knows
  visibleVariables: z.array(VariableStateSchema),
  availableSpools: z.array(z.object({
    spoolId: z.string(),
    spoolName: z.string(),
    description: z.string()
  })),
  activeSpools: z.array(SpoolProgressSchema),
  currentEncounter: EncounterSchema.optional(),
  availableChoices: z.array(ChoiceSchema),
  
  // Agent's private state
  privateMemory: z.record(z.unknown()).optional(),
  
  // What this agent has experienced (for context)
  recentHistory: z.array(z.object({
    frame: z.number(),
    event: z.string(),
    summary: z.string()
  })).optional()
});
export type AgentView = z.infer<typeof AgentViewSchema>;

// ============================================================================
// Narrative Events - What Happens in the Simulation
// ============================================================================

export const NarrativeEventTypeSchema = z.enum([
  'SPOOL_ENTERED',
  'SPOOL_COMPLETED',
  'SPOOL_ABANDONED',
  'ENCOUNTER_STARTED',
  'CHOICE_MADE',
  'VARIABLE_CHANGED',
  'GATE_EVALUATED',
  'MESSAGE_SENT',
  'MESSAGE_RECEIVED',
  'AGENT_OBSERVATION',
  'SYSTEM_EVENT'
]);
export type NarrativeEventType = z.infer<typeof NarrativeEventTypeSchema>;

export const NarrativeEventSchema = z.object({
  id: z.string(),
  simulationId: z.string(),
  frame: z.number(),
  eventType: NarrativeEventTypeSchema,
  agentId: z.string().optional(),
  
  // Event-specific payload
  spoolId: z.string().optional(),
  encounterId: z.string().optional(),
  choiceId: z.string().optional(),
  variableId: z.string().optional(),
  gateId: z.string().optional(),
  
  // For messages between agents
  recipientId: z.string().optional(),
  messageContent: z.string().optional(),
  
  // Full payload for analysis
  payload: z.record(z.unknown()),
  
  timestamp: z.date()
});
export type NarrativeEvent = z.infer<typeof NarrativeEventSchema>;

// ============================================================================
// Session - A Complete Playthrough
// ============================================================================

/**
 * A Session is one agent's complete journey through a storyworld.
 * Sessions are the unit of SAE analysis - we want to understand
 * how session N influences decisions in session N+1.
 */
export const SessionOutcomeSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  simulationId: z.string(),
  storyworldId: z.string(),
  
  // Trajectory
  startFrame: z.number(),
  endFrame: z.number(),
  totalChoices: z.number(),
  
  // What happened
  spoolsEntered: z.array(z.string()),
  spoolsCompleted: z.array(z.string()),
  endingsReached: z.array(z.string()),  // Terminal encounter IDs
  
  // Final state snapshot
  finalVariableState: z.array(VariableStateSchema),
  
  // Choice sequence (for SAE analysis)
  choiceSequence: z.array(z.object({
    frame: z.number(),
    encounterId: z.string(),
    choiceId: z.string(),
    availableChoices: z.array(z.string()),  // What else could they have chosen
    choiceIndex: z.number()                  // Position in available choices
  })),
  
  // Metrics for analysis
  metrics: z.record(z.number()).optional(),
  
  // Link to prior sessions (for cross-session analysis)
  priorSessionIds: z.array(z.string()).optional()
});
export type SessionOutcome = z.infer<typeof SessionOutcomeSchema>;
