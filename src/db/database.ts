/**
 * StoryForge - Database Layer
 * 
 * SQLite persistence for narrative simulations.
 * Schema designed for:
 * - Epistemic isolation (agent views are separate from world state)
 * - Session analysis (tracking choices across runs)
 * - SAE preparation (structured choice sequences)
 */

import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import {
  Simulation,
  SimulationEvent,
  StateSnapshot,
  AgentSlot,
  AgentProfile,
  Frame
} from '../core/types.js';
import {
  Storyworld,
  SessionOutcome,
  NarrativeEvent,
  AgentView,
  SpoolProgress,
  VariableState
} from '../narrative/types.js';

// ============================================================================
// Schema - Storyworld-Native, Not Game-Native
// ============================================================================

const SCHEMA = `
-- Storyworlds (the narrative environments)
CREATE TABLE IF NOT EXISTS storyworlds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT,
  schema_json TEXT NOT NULL,  -- Complete Storyworld JSON
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Simulations (runs through storyworlds)
CREATE TABLE IF NOT EXISTS simulations (
  id TEXT PRIMARY KEY,
  experiment_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  storyworld_ids TEXT NOT NULL,  -- JSON array
  config TEXT NOT NULL,          -- JSON
  current_frame INTEGER DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  final_state TEXT,              -- JSON
  metadata TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Agent slots (participants in simulation)
CREATE TABLE IF NOT EXISTS agent_slots (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL,
  name TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  model_id TEXT,
  model_config TEXT,             -- JSON
  view_filter_id TEXT,
  is_active INTEGER DEFAULT 1,
  joined_at_frame INTEGER NOT NULL,
  exited_at_frame INTEGER,
  agent_profile_id TEXT,
  metadata TEXT,
  FOREIGN KEY (simulation_id) REFERENCES simulations(id),
  FOREIGN KEY (agent_profile_id) REFERENCES agent_profiles(id)
);

-- Agent profiles (cross-session identity for SAE analysis)
CREATE TABLE IF NOT EXISTS agent_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  model_id TEXT,
  total_sessions INTEGER DEFAULT 0,
  total_choices INTEGER DEFAULT 0,
  session_history TEXT,          -- JSON array
  behavior_embedding TEXT,       -- JSON array of floats
  last_analyzed_at TEXT,
  analysis_version TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Frames (time slices, not turns)
CREATE TABLE IF NOT EXISTS frames (
  simulation_id TEXT NOT NULL,
  frame_index INTEGER NOT NULL,
  stage TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  metadata TEXT,
  PRIMARY KEY (simulation_id, frame_index),
  FOREIGN KEY (simulation_id) REFERENCES simulations(id)
);

-- Unified event log (everything that happens)
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL,
  frame INTEGER NOT NULL,
  stage TEXT NOT NULL,
  category TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT,
  target_id TEXT,
  payload TEXT NOT NULL,         -- JSON
  visibility TEXT,               -- JSON: {agentId: boolean}
  timestamp TEXT NOT NULL,
  FOREIGN KEY (simulation_id) REFERENCES simulations(id)
);

-- Agent views (epistemically isolated snapshots)
CREATE TABLE IF NOT EXISTS agent_views (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  frame INTEGER NOT NULL,
  visible_variables TEXT NOT NULL,   -- JSON array
  available_spools TEXT NOT NULL,    -- JSON array
  active_spools TEXT NOT NULL,       -- JSON array
  current_encounter TEXT,            -- JSON
  available_choices TEXT NOT NULL,   -- JSON array
  private_memory TEXT,               -- JSON
  recent_history TEXT,               -- JSON array
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (simulation_id) REFERENCES simulations(id),
  FOREIGN KEY (agent_id) REFERENCES agent_slots(id)
);

-- Variable states (world state at each frame)
CREATE TABLE IF NOT EXISTS variable_states (
  simulation_id TEXT NOT NULL,
  frame INTEGER NOT NULL,
  variable_id TEXT NOT NULL,
  value TEXT NOT NULL,           -- JSON
  modified_by TEXT,
  PRIMARY KEY (simulation_id, frame, variable_id),
  FOREIGN KEY (simulation_id) REFERENCES simulations(id)
);

-- Spool progress (narrative arc tracking per agent)
CREATE TABLE IF NOT EXISTS spool_progress (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  spool_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_encounter_id TEXT,
  entered_at_frame INTEGER NOT NULL,
  completed_at_frame INTEGER,
  choice_history TEXT NOT NULL,  -- JSON array
  FOREIGN KEY (simulation_id) REFERENCES simulations(id),
  FOREIGN KEY (agent_id) REFERENCES agent_slots(id)
);

-- Session outcomes (complete playthroughs for SAE)
CREATE TABLE IF NOT EXISTS session_outcomes (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  storyworld_id TEXT NOT NULL,
  agent_profile_id TEXT,
  start_frame INTEGER NOT NULL,
  end_frame INTEGER NOT NULL,
  total_choices INTEGER NOT NULL,
  spools_entered TEXT NOT NULL,      -- JSON array
  spools_completed TEXT NOT NULL,    -- JSON array
  endings_reached TEXT NOT NULL,     -- JSON array
  final_variable_state TEXT NOT NULL,-- JSON array
  choice_sequence TEXT NOT NULL,     -- JSON array (for SAE)
  metrics TEXT,                      -- JSON
  prior_session_ids TEXT,            -- JSON array
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (simulation_id) REFERENCES simulations(id),
  FOREIGN KEY (agent_id) REFERENCES agent_slots(id),
  FOREIGN KEY (storyworld_id) REFERENCES storyworlds(id),
  FOREIGN KEY (agent_profile_id) REFERENCES agent_profiles(id)
);

-- State snapshots (for replay/debugging)
CREATE TABLE IF NOT EXISTS state_snapshots (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL,
  frame INTEGER NOT NULL,
  variable_states TEXT NOT NULL,     -- JSON array
  agent_states TEXT NOT NULL,        -- JSON array
  metrics TEXT,                      -- JSON
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (simulation_id) REFERENCES simulations(id)
);

-- Analysis artifacts (SAE features, embeddings, etc.)
CREATE TABLE IF NOT EXISTS analysis_artifacts (
  id TEXT PRIMARY KEY,
  simulation_id TEXT,
  experiment_id TEXT,
  artifact_type TEXT NOT NULL,
  data TEXT NOT NULL,                -- JSON
  agent_profile_id TEXT,
  session_ids TEXT,                  -- JSON array
  analysis_version TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Inter-agent messages
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL,
  frame INTEGER NOT NULL,
  sender_id TEXT NOT NULL,
  recipient_id TEXT,
  channel TEXT NOT NULL,
  content TEXT NOT NULL,
  content_type TEXT NOT NULL,
  encounter_id TEXT,
  spool_id TEXT,
  delivered_at_frame INTEGER,
  read_by_recipient INTEGER DEFAULT 0,
  metadata TEXT,
  sent_at TEXT NOT NULL,
  FOREIGN KEY (simulation_id) REFERENCES simulations(id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_events_sim_frame ON events(simulation_id, frame);
CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);
CREATE INDEX IF NOT EXISTS idx_events_actor ON events(actor_id);
CREATE INDEX IF NOT EXISTS idx_agent_views_sim_agent ON agent_views(simulation_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_variable_states_sim ON variable_states(simulation_id);
CREATE INDEX IF NOT EXISTS idx_spool_progress_agent ON spool_progress(agent_id);
CREATE INDEX IF NOT EXISTS idx_session_outcomes_profile ON session_outcomes(agent_profile_id);
CREATE INDEX IF NOT EXISTS idx_session_outcomes_storyworld ON session_outcomes(storyworld_id);
CREATE INDEX IF NOT EXISTS idx_messages_sim_frame ON messages(simulation_id, frame);
CREATE INDEX IF NOT EXISTS idx_analysis_profile ON analysis_artifacts(agent_profile_id);
`;

// ============================================================================
// Database Manager
// ============================================================================

export interface DatabaseConfig {
  path: string;
  verbose?: boolean;
}

export class StoryforgeDatabase {
  private db: Database.Database;

  constructor(config: DatabaseConfig) {
    this.db = new Database(config.path, {
      verbose: config.verbose ? console.log : undefined
    });

    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    this.db.exec(SCHEMA);
  }

  // --------------------------------------------------------------------------
  // Storyworld Operations
  // --------------------------------------------------------------------------

  saveStoryworld(storyworld: Storyworld): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO storyworlds (id, name, version, description, schema_json, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    stmt.run(
      storyworld.id,
      storyworld.name,
      storyworld.version,
      storyworld.description,
      JSON.stringify(storyworld)
    );
  }

  loadStoryworld(id: string): Storyworld | null {
    const row = this.db.prepare('SELECT schema_json FROM storyworlds WHERE id = ?').get(id) as any;
    if (!row) return null;
    return JSON.parse(row.schema_json);
  }

  listStoryworlds(): { id: string; name: string; version: string }[] {
    return this.db.prepare('SELECT id, name, version FROM storyworlds ORDER BY name').all() as any[];
  }

  // --------------------------------------------------------------------------
  // Simulation Operations
  // --------------------------------------------------------------------------

  saveSimulation(sim: Simulation): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO simulations (
        id, experiment_id, name, status, storyworld_ids, config,
        current_frame, started_at, completed_at, final_state, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      sim.id,
      sim.experimentId || null,
      sim.name,
      sim.status,
      JSON.stringify(sim.storyworldIds),
      JSON.stringify(sim.config),
      sim.currentFrame,
      sim.startedAt?.toISOString() || null,
      sim.completedAt?.toISOString() || null,
      sim.finalState ? JSON.stringify(sim.finalState) : null,
      sim.metadata ? JSON.stringify(sim.metadata) : null
    );

    // Save agents
    for (const agent of sim.agents) {
      this.saveAgentSlot(agent);
    }
  }

  loadSimulation(id: string): Simulation | null {
    const row = this.db.prepare('SELECT * FROM simulations WHERE id = ?').get(id) as any;
    if (!row) return null;

    const agents = this.loadAgentSlots(id);

    return {
      id: row.id,
      experimentId: row.experiment_id || undefined,
      name: row.name,
      status: row.status,
      storyworldIds: JSON.parse(row.storyworld_ids),
      agents,
      currentFrame: row.current_frame,
      config: JSON.parse(row.config),
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      finalState: row.final_state ? JSON.parse(row.final_state) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    };
  }

  // --------------------------------------------------------------------------
  // Agent Operations
  // --------------------------------------------------------------------------

  saveAgentSlot(agent: AgentSlot): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO agent_slots (
        id, simulation_id, name, agent_type, model_id, model_config,
        view_filter_id, is_active, joined_at_frame, exited_at_frame,
        agent_profile_id, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      agent.id,
      agent.simulationId,
      agent.name,
      agent.agentType,
      agent.modelId || null,
      agent.modelConfig ? JSON.stringify(agent.modelConfig) : null,
      agent.viewFilterId || null,
      agent.isActive ? 1 : 0,
      agent.joinedAtFrame,
      agent.exitedAtFrame || null,
      agent.agentProfileId || null,
      agent.metadata ? JSON.stringify(agent.metadata) : null
    );
  }

  loadAgentSlots(simulationId: string): AgentSlot[] {
    const rows = this.db.prepare(
      'SELECT * FROM agent_slots WHERE simulation_id = ?'
    ).all(simulationId) as any[];

    return rows.map(row => ({
      id: row.id,
      simulationId: row.simulation_id,
      name: row.name,
      agentType: row.agent_type,
      modelId: row.model_id || undefined,
      modelConfig: row.model_config ? JSON.parse(row.model_config) : undefined,
      viewFilterId: row.view_filter_id || undefined,
      isActive: row.is_active === 1,
      joinedAtFrame: row.joined_at_frame,
      exitedAtFrame: row.exited_at_frame || undefined,
      agentProfileId: row.agent_profile_id || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    }));
  }

  // --------------------------------------------------------------------------
  // Agent Profile Operations (for SAE analysis)
  // --------------------------------------------------------------------------

  saveAgentProfile(profile: AgentProfile): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO agent_profiles (
        id, name, model_id, total_sessions, total_choices,
        session_history, behavior_embedding, last_analyzed_at, analysis_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      profile.id,
      profile.name,
      profile.modelId || null,
      profile.totalSessions,
      profile.totalChoices,
      JSON.stringify(profile.sessionHistory),
      profile.behaviorEmbedding ? JSON.stringify(profile.behaviorEmbedding) : null,
      profile.lastAnalyzedAt?.toISOString() || null,
      profile.analysisVersion || null
    );
  }

  loadAgentProfile(id: string): AgentProfile | null {
    const row = this.db.prepare('SELECT * FROM agent_profiles WHERE id = ?').get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      modelId: row.model_id || undefined,
      totalSessions: row.total_sessions,
      totalChoices: row.total_choices,
      sessionHistory: JSON.parse(row.session_history),
      behaviorEmbedding: row.behavior_embedding ? JSON.parse(row.behavior_embedding) : undefined,
      lastAnalyzedAt: row.last_analyzed_at ? new Date(row.last_analyzed_at) : undefined,
      analysisVersion: row.analysis_version || undefined
    };
  }

  // --------------------------------------------------------------------------
  // Event Operations
  // --------------------------------------------------------------------------

  saveEvent(event: SimulationEvent): void {
    const stmt = this.db.prepare(`
      INSERT INTO events (
        id, simulation_id, frame, stage, category, event_type,
        actor_id, target_id, payload, visibility, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      event.id,
      event.simulationId,
      event.frame,
      event.stage,
      event.category,
      event.eventType,
      event.actorId || null,
      event.targetId || null,
      JSON.stringify(event.payload),
      event.isVisible ? JSON.stringify(event.isVisible) : null,
      event.timestamp.toISOString()
    );
  }

  loadEvents(simulationId: string, options?: {
    category?: string;
    actorId?: string;
    frameStart?: number;
    frameEnd?: number;
  }): SimulationEvent[] {
    let sql = 'SELECT * FROM events WHERE simulation_id = ?';
    const params: any[] = [simulationId];

    if (options?.category) {
      sql += ' AND category = ?';
      params.push(options.category);
    }
    if (options?.actorId) {
      sql += ' AND actor_id = ?';
      params.push(options.actorId);
    }
    if (options?.frameStart !== undefined) {
      sql += ' AND frame >= ?';
      params.push(options.frameStart);
    }
    if (options?.frameEnd !== undefined) {
      sql += ' AND frame <= ?';
      params.push(options.frameEnd);
    }

    sql += ' ORDER BY frame, timestamp';

    const rows = this.db.prepare(sql).all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      simulationId: row.simulation_id,
      frame: row.frame,
      stage: row.stage,
      category: row.category,
      eventType: row.event_type,
      actorId: row.actor_id || undefined,
      targetId: row.target_id || undefined,
      payload: JSON.parse(row.payload),
      isVisible: row.visibility ? JSON.parse(row.visibility) : undefined,
      timestamp: new Date(row.timestamp)
    }));
  }

  // --------------------------------------------------------------------------
  // Agent View Operations (Epistemic Isolation)
  // --------------------------------------------------------------------------

  saveAgentView(view: AgentView): void {
    const stmt = this.db.prepare(`
      INSERT INTO agent_views (
        id, simulation_id, agent_id, frame, visible_variables,
        available_spools, active_spools, current_encounter,
        available_choices, private_memory, recent_history
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      uuid(),
      view.simulationId,
      view.agentId,
      view.frame,
      JSON.stringify(view.visibleVariables),
      JSON.stringify(view.availableSpools),
      JSON.stringify(view.activeSpools),
      view.currentEncounter ? JSON.stringify(view.currentEncounter) : null,
      JSON.stringify(view.availableChoices),
      view.privateMemory ? JSON.stringify(view.privateMemory) : null,
      view.recentHistory ? JSON.stringify(view.recentHistory) : null
    );
  }

  loadAgentView(simulationId: string, agentId: string, frame: number): AgentView | null {
    const row = this.db.prepare(`
      SELECT * FROM agent_views 
      WHERE simulation_id = ? AND agent_id = ? AND frame = ?
    `).get(simulationId, agentId, frame) as any;

    if (!row) return null;

    return {
      agentId: row.agent_id,
      simulationId: row.simulation_id,
      frame: row.frame,
      visibleVariables: JSON.parse(row.visible_variables),
      availableSpools: JSON.parse(row.available_spools),
      activeSpools: JSON.parse(row.active_spools),
      currentEncounter: row.current_encounter ? JSON.parse(row.current_encounter) : undefined,
      availableChoices: JSON.parse(row.available_choices),
      privateMemory: row.private_memory ? JSON.parse(row.private_memory) : undefined,
      recentHistory: row.recent_history ? JSON.parse(row.recent_history) : undefined
    };
  }

  // --------------------------------------------------------------------------
  // Session Outcome Operations (for SAE)
  // --------------------------------------------------------------------------

  saveSessionOutcome(outcome: SessionOutcome): void {
    const stmt = this.db.prepare(`
      INSERT INTO session_outcomes (
        id, simulation_id, agent_id, storyworld_id, agent_profile_id,
        start_frame, end_frame, total_choices, spools_entered, spools_completed,
        endings_reached, final_variable_state, choice_sequence, metrics, prior_session_ids
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      outcome.sessionId,
      outcome.simulationId,
      outcome.agentId,
      outcome.storyworldId,
      outcome.agentId, // Using agentId as profile link for now
      outcome.startFrame,
      outcome.endFrame,
      outcome.totalChoices,
      JSON.stringify(outcome.spoolsEntered),
      JSON.stringify(outcome.spoolsCompleted),
      JSON.stringify(outcome.endingsReached),
      JSON.stringify(outcome.finalVariableState),
      JSON.stringify(outcome.choiceSequence),
      outcome.metrics ? JSON.stringify(outcome.metrics) : null,
      outcome.priorSessionIds ? JSON.stringify(outcome.priorSessionIds) : null
    );
  }

  loadSessionOutcomes(options: {
    agentProfileId?: string;
    storyworldId?: string;
    simulationId?: string;
  }): SessionOutcome[] {
    let sql = 'SELECT * FROM session_outcomes WHERE 1=1';
    const params: any[] = [];

    if (options.agentProfileId) {
      sql += ' AND agent_profile_id = ?';
      params.push(options.agentProfileId);
    }
    if (options.storyworldId) {
      sql += ' AND storyworld_id = ?';
      params.push(options.storyworldId);
    }
    if (options.simulationId) {
      sql += ' AND simulation_id = ?';
      params.push(options.simulationId);
    }

    sql += ' ORDER BY created_at';

    const rows = this.db.prepare(sql).all(...params) as any[];

    return rows.map(row => ({
      sessionId: row.id,
      agentId: row.agent_id,
      simulationId: row.simulation_id,
      storyworldId: row.storyworld_id,
      startFrame: row.start_frame,
      endFrame: row.end_frame,
      totalChoices: row.total_choices,
      spoolsEntered: JSON.parse(row.spools_entered),
      spoolsCompleted: JSON.parse(row.spools_completed),
      endingsReached: JSON.parse(row.endings_reached),
      finalVariableState: JSON.parse(row.final_variable_state),
      choiceSequence: JSON.parse(row.choice_sequence),
      metrics: row.metrics ? JSON.parse(row.metrics) : undefined,
      priorSessionIds: row.prior_session_ids ? JSON.parse(row.prior_session_ids) : undefined
    }));
  }

  // --------------------------------------------------------------------------
  // Analysis Artifacts
  // --------------------------------------------------------------------------

  saveAnalysisArtifact(artifact: {
    id?: string;
    simulationId?: string;
    experimentId?: string;
    artifactType: string;
    data: unknown;
    agentProfileId?: string;
    sessionIds?: string[];
    analysisVersion: string;
  }): string {
    const id = artifact.id ?? uuid();
    const stmt = this.db.prepare(`
      INSERT INTO analysis_artifacts (
        id, simulation_id, experiment_id, artifact_type, data,
        agent_profile_id, session_ids, analysis_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      artifact.simulationId || null,
      artifact.experimentId || null,
      artifact.artifactType,
      JSON.stringify(artifact.data),
      artifact.agentProfileId || null,
      artifact.sessionIds ? JSON.stringify(artifact.sessionIds) : null,
      artifact.analysisVersion
    );
    return id;
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  close(): void {
    this.db.close();
  }

  raw(): Database.Database {
    return this.db;
  }
}
