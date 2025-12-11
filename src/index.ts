/**
 * StoryForge - Multi-Agent Narrative Simulation Engine
 * 
 * A framework for running storyworld-mediated agent simulations with:
 * - Epistemic isolation (agents can't backchannel)
 * - Session tracking for SAE analysis
 * - Cross-session behavioral analysis
 * - Optional strategy layer (turns, phases, actions)
 * - Neural snapshot capture ("EEG for LLMs")
 * 
 * NOT a game engine. A dramaturgical OS with enforced epistemic partitions.
 * 
 * @author Patrick / TradeLayer
 * @license MIT
 */

// Core simulation types
export {
  Simulation,
  SimulationStatus,
  SimulationEvent,
  AgentSlot,
  AgentType,
  AgentProfile,
  Frame,
  FrameStage,
  StateSnapshot,
  EventCategory,
  AgentMessage,
  MessageChannel,
  AnalysisArtifact,
  AnalysisArtifactType,
  // Schemas
  SimulationSchema,
  SimulationStatusSchema,
  SimulationEventSchema,
  AgentSlotSchema,
  AgentTypeSchema,
  AgentProfileSchema,
  FrameSchema,
  FrameStageSchema,
  StateSnapshotSchema,
  EventCategorySchema,
  AgentMessageSchema,
  MessageChannelSchema,
  AnalysisArtifactSchema,
  AnalysisArtifactTypeSchema
} from './core/types.js';

export {
  SimulationEngine,
  EngineConfig,
  AgentActionHandler,
  EventHandler
} from './core/engine.js';

// Narrative types (Storyworld ontology)
export {
  Storyworld,
  Spool,
  SpoolStatus,
  SpoolProgress,
  Encounter,
  Choice,
  Gate,
  GateCondition,
  GateOperator,
  Variable,
  VariableType,
  VariableState,
  VariableMutation,
  AgentView,
  NarrativeEvent,
  NarrativeEventType,
  SessionOutcome,
  // Schemas
  StoryworldSchema,
  SpoolSchema,
  SpoolStatusSchema,
  SpoolProgressSchema,
  EncounterSchema,
  ChoiceSchema,
  GateSchema,
  GateConditionSchema,
  GateOperatorSchema,
  VariableSchema,
  VariableTypeSchema,
  VariableStateSchema,
  VariableMutationSchema,
  AgentViewSchema,
  NarrativeEventSchema,
  NarrativeEventTypeSchema,
  SessionOutcomeSchema
} from './narrative/types.js';

// Strategy layer (optional overlay)
export {
  GameTurn,
  GamePhase,
  PhaseType,
  ActionOrder,
  ActionCategory,
  ActionResult,
  PhaseResolution,
  StrategyConfig,
  StrategyNarrativeBridge,
  // Schemas
  GameTurnSchema,
  GamePhaseSchema,
  PhaseTypeSchema,
  ActionOrderSchema,
  ActionCategorySchema,
  ActionResultSchema,
  PhaseResolutionSchema,
  StrategyConfigSchema
} from './strategy/types.js';

// Neural snapshot system (SAE / EEG)
export {
  NeuralSnapshot,
  SAEConfig,
  CaptureConfig,
  RepresentationType,
  FeatureTrajectory,
  FeatureComparison,
  FeatureBehaviorMap,
  SessionNeuralProfile,
  CrossSessionNeuralDelta,
  // Schemas
  NeuralSnapshotSchema,
  SAEConfigSchema,
  CaptureConfigSchema,
  RepresentationTypeSchema,
  FeatureTrajectorySchema,
  FeatureComparisonSchema,
  FeatureBehaviorMapSchema,
  SessionNeuralProfileSchema,
  CrossSessionNeuralDeltaSchema
} from './neural/types.js';

export {
  NeuralCaptureService,
  SAEEncoder,
  RepresentationExtractor,
  MockSAEEncoder,
  MockRepresentationExtractor
} from './neural/capture.js';

// Database layer
export {
  StoryforgeDatabase,
  DatabaseConfig
} from './db/database.js';

export {
  STRATEGY_SCHEMA,
  NEURAL_SCHEMA,
  EXTENDED_SCHEMA
} from './db/extended-schema.js';

// Tracking & SAE
export {
  NarrativeTracker,
  SAEFeatureExtractor,
  ExperimentConfig,
  RunStatus
} from './tracking/tracker.js';

// ============================================================================
// Quick Start Factory
// ============================================================================

import { SimulationEngine, EngineConfig } from './core/engine.js';
import { StoryforgeDatabase, DatabaseConfig } from './db/database.js';
import { NarrativeTracker, ExperimentConfig } from './tracking/tracker.js';
import { Storyworld } from './narrative/types.js';

export interface StoryforgeConfig {
  dbPath?: string;
  trackingUri?: string;
  experimentName?: string;
  engineConfig?: EngineConfig;
}

/**
 * Create a complete StoryForge setup.
 */
export function createStoryforge(config: StoryforgeConfig = {}): {
  engine: SimulationEngine;
  db: StoryforgeDatabase;
  tracker: NarrativeTracker;
} {
  const db = new StoryforgeDatabase({
    path: config.dbPath ?? './storyforge.db'
  });

  const tracker = new NarrativeTracker({
    trackingUri: config.trackingUri ?? './mlruns',
    experimentName: config.experimentName ?? 'storyforge-experiment'
  });

  const engine = new SimulationEngine(config.engineConfig);

  // Wire up event persistence
  engine.addEventListener((event) => {
    db.saveEvent(event);
  });

  return { engine, db, tracker };
}
