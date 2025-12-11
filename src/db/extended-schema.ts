/**
 * StoryForge - Extended Database Schema
 * 
 * Additional tables for:
 * - Strategy layer (turns, phases, action orders)
 * - Neural snapshots (SAE features per frame)
 * - Cross-session analysis
 */

// This extends the base schema from db/database.ts

export const STRATEGY_SCHEMA = `
-- ============================================================================
-- STRATEGY LAYER TABLES
-- ============================================================================

-- Game turns (groupings of frames)
CREATE TABLE IF NOT EXISTS game_turns (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  frame_start INTEGER NOT NULL,
  frame_end INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  metadata TEXT,
  FOREIGN KEY (simulation_id) REFERENCES simulations(id),
  UNIQUE(simulation_id, turn_index)
);

-- Game phases (subdivisions of turns)
CREATE TABLE IF NOT EXISTS game_phases (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  simulation_id TEXT NOT NULL,
  phase_type TEXT NOT NULL,
  phase_index INTEGER NOT NULL,
  frame_start INTEGER NOT NULL,
  frame_end INTEGER NOT NULL,
  status TEXT NOT NULL,
  expected_actors TEXT,          -- JSON array
  received_actions TEXT,         -- JSON array of order IDs
  metadata TEXT,
  FOREIGN KEY (turn_id) REFERENCES game_turns(id),
  FOREIGN KEY (simulation_id) REFERENCES simulations(id)
);

-- Action orders (strategic commands)
CREATE TABLE IF NOT EXISTS action_orders (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  phase_id TEXT NOT NULL,
  frame_id INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  category TEXT NOT NULL,
  action_type TEXT NOT NULL,
  payload TEXT NOT NULL,         -- JSON
  target_id TEXT,
  target_location TEXT,
  target_asset TEXT,
  status TEXT NOT NULL,
  validation_notes TEXT,
  resolution_notes TEXT,
  submitted_at TEXT NOT NULL,
  resolved_at TEXT,
  metadata TEXT,
  FOREIGN KEY (simulation_id) REFERENCES simulations(id),
  FOREIGN KEY (turn_id) REFERENCES game_turns(id),
  FOREIGN KEY (phase_id) REFERENCES game_phases(id)
);

-- Phase resolutions (what happened each phase)
CREATE TABLE IF NOT EXISTS phase_resolutions (
  id TEXT PRIMARY KEY,
  phase_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  simulation_id TEXT NOT NULL,
  action_results TEXT NOT NULL,  -- JSON array
  state_changes TEXT NOT NULL,   -- JSON array
  summary TEXT NOT NULL,
  resolved_at TEXT NOT NULL,
  FOREIGN KEY (phase_id) REFERENCES game_phases(id),
  FOREIGN KEY (turn_id) REFERENCES game_turns(id),
  FOREIGN KEY (simulation_id) REFERENCES simulations(id)
);

-- Strategy-Narrative bridge
CREATE TABLE IF NOT EXISTS strategy_narrative_bridge (
  id TEXT PRIMARY KEY,
  action_order_id TEXT NOT NULL,
  encounter_id TEXT NOT NULL,
  choice_id TEXT NOT NULL,
  strategic_context TEXT NOT NULL,  -- JSON
  narrative_result TEXT,            -- JSON
  FOREIGN KEY (action_order_id) REFERENCES action_orders(id)
);

-- Indexes for strategy tables
CREATE INDEX IF NOT EXISTS idx_turns_sim ON game_turns(simulation_id);
CREATE INDEX IF NOT EXISTS idx_phases_turn ON game_phases(turn_id);
CREATE INDEX IF NOT EXISTS idx_phases_sim ON game_phases(simulation_id);
CREATE INDEX IF NOT EXISTS idx_orders_phase ON action_orders(phase_id);
CREATE INDEX IF NOT EXISTS idx_orders_actor ON action_orders(actor_id);
CREATE INDEX IF NOT EXISTS idx_orders_frame ON action_orders(frame_id);
CREATE INDEX IF NOT EXISTS idx_bridge_order ON strategy_narrative_bridge(action_order_id);
`;

export const NEURAL_SCHEMA = `
-- ============================================================================
-- NEURAL SNAPSHOT TABLES (SAE / EEG-style logging)
-- ============================================================================

-- SAE configurations
CREATE TABLE IF NOT EXISTS sae_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  input_dim INTEGER NOT NULL,
  hidden_dim INTEGER NOT NULL,
  sparsity_target REAL,
  trained_on TEXT NOT NULL,      -- JSON: modelId, layer, etc.
  feature_labels TEXT,           -- JSON: featureIdx -> label
  feature_clusters TEXT,         -- JSON: clusterName -> featureIdxs
  metadata TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Neural snapshots (per-frame model state)
CREATE TABLE IF NOT EXISTS neural_snapshots (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL,
  frame_id INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  representation_type TEXT NOT NULL,
  source_layer TEXT,
  sae_id TEXT NOT NULL,
  
  -- Sparse features (the EEG signal)
  active_features TEXT NOT NULL,  -- JSON: {featureIdx: activation}
  top_k TEXT NOT NULL,            -- JSON array of top features
  
  -- Aggregate stats
  sparsity REAL NOT NULL,
  total_activation REAL NOT NULL,
  max_activation REAL NOT NULL,
  
  -- Context
  context TEXT NOT NULL,          -- JSON: encounter, action, etc.
  
  captured_at TEXT NOT NULL,
  FOREIGN KEY (simulation_id) REFERENCES simulations(id),
  FOREIGN KEY (sae_id) REFERENCES sae_configs(id)
);

-- Feature trajectories (time series per feature)
CREATE TABLE IF NOT EXISTS feature_trajectories (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  sae_id TEXT NOT NULL,
  feature_index INTEGER NOT NULL,
  feature_label TEXT,
  trajectory TEXT NOT NULL,       -- JSON array: [{frameId, activation, context}]
  mean_activation REAL NOT NULL,
  max_activation REAL NOT NULL,
  activation_frequency REAL NOT NULL,
  behavior_correlations TEXT,     -- JSON: {behavior: correlation}
  FOREIGN KEY (simulation_id) REFERENCES simulations(id),
  FOREIGN KEY (sae_id) REFERENCES sae_configs(id),
  UNIQUE(simulation_id, agent_id, sae_id, feature_index)
);

-- Session neural profiles
CREATE TABLE IF NOT EXISTS session_neural_profiles (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  simulation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  sae_id TEXT NOT NULL,
  mean_features TEXT NOT NULL,    -- JSON: {featureIdx: mean}
  feature_variance TEXT NOT NULL, -- JSON: {featureIdx: variance}
  dominant_features TEXT NOT NULL,-- JSON array
  transient_features TEXT,        -- JSON array
  feature_drift TEXT,             -- JSON array
  behavioral_profile TEXT,        -- JSON: {behavior: strength}
  computed_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES session_outcomes(id),
  FOREIGN KEY (simulation_id) REFERENCES simulations(id),
  FOREIGN KEY (sae_id) REFERENCES sae_configs(id)
);

-- Cross-session neural deltas
CREATE TABLE IF NOT EXISTS cross_session_neural_deltas (
  id TEXT PRIMARY KEY,
  agent_profile_id TEXT NOT NULL,
  prior_session_id TEXT NOT NULL,
  current_session_id TEXT NOT NULL,
  sae_id TEXT NOT NULL,
  feature_deltas TEXT NOT NULL,   -- JSON array
  emergent_features TEXT,         -- JSON array of feature indices
  suppressed_features TEXT,       -- JSON array of feature indices
  behavioral_shift TEXT,          -- JSON
  hypothesized_cause TEXT,        -- JSON
  computed_at TEXT NOT NULL,
  FOREIGN KEY (agent_profile_id) REFERENCES agent_profiles(id),
  FOREIGN KEY (sae_id) REFERENCES sae_configs(id)
);

-- Feature-behavior mappings (interpretability)
CREATE TABLE IF NOT EXISTS feature_behavior_maps (
  id TEXT PRIMARY KEY,
  sae_id TEXT NOT NULL,
  feature_index INTEGER NOT NULL,
  associated_behaviors TEXT NOT NULL,  -- JSON array
  narrative_triggers TEXT,             -- JSON array
  interpretation TEXT,
  interpretation_confidence REAL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sae_id) REFERENCES sae_configs(id),
  UNIQUE(sae_id, feature_index)
);

-- Indexes for neural tables
CREATE INDEX IF NOT EXISTS idx_snapshots_sim_frame ON neural_snapshots(simulation_id, frame_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_agent ON neural_snapshots(agent_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_sae ON neural_snapshots(sae_id);
CREATE INDEX IF NOT EXISTS idx_trajectories_agent ON feature_trajectories(agent_id);
CREATE INDEX IF NOT EXISTS idx_neural_profiles_session ON session_neural_profiles(session_id);
CREATE INDEX IF NOT EXISTS idx_neural_deltas_profile ON cross_session_neural_deltas(agent_profile_id);
CREATE INDEX IF NOT EXISTS idx_behavior_maps_sae ON feature_behavior_maps(sae_id);
`;

// Combined schema for easy import
export const EXTENDED_SCHEMA = STRATEGY_SCHEMA + '\n' + NEURAL_SCHEMA;
