/**
 * StoryForge - Core Simulation Types
 * 
 * Ontology for multi-agent narrative simulation.
 * NOT a game engine - a dramaturgical OS with epistemic partitions.
 * 
 * Key concepts:
 * - Simulation: A multi-agent run through one or more storyworlds
 * - Frame: A discrete time slice (not a "turn" - no implicit sequencing)
 * - AgentSlot: A participant position (human, LLM, hybrid)
 * - Event: Anything that happens (unified log, not separate tables)
 */

import { z } from 'zod';

// ============================================================================
// Frames - Time Slices
// ============================================================================

/**
 * A Frame is a discrete moment in simulation time.
 * Unlike "turns", frames don't imply any particular structure.
 * Multiple events can occur in a single frame.
 */
export const FrameStageSchema = z.enum([
  'OBSERVATION',    // Agents receive their views
  'DELIBERATION',   // Agents process and decide
  'ACTION',         // Agents submit choices/messages
  'RESOLUTION',     // System processes all actions
  'TRANSITION',     // World state updates, spools advance
  'EVALUATION'      // Metrics computed, snapshots taken
]);
export type FrameStage = z.infer<typeof FrameStageSchema>;

export const FrameSchema = z.object({
  index: z.number().int().nonnegative(),
  simulationId: z.string(),
  stage: FrameStageSchema,
  startedAt: z.date(),
  completedAt: z.date().optional(),
  metadata: z.record(z.unknown()).optional()
});
export type Frame = z.infer<typeof FrameSchema>;

// ============================================================================
// Agents - Participants with Epistemic Boundaries
// ============================================================================

export const AgentTypeSchema = z.enum([
  'LLM',           // Language model agent
  'HUMAN',         // Human participant
  'HYBRID',        // Human with LLM assistance
  'SCRIPTED',      // Deterministic/rule-based
  'RANDOM'         // Random baseline
]);
export type AgentType = z.infer<typeof AgentTypeSchema>;

export const AgentSlotSchema = z.object({
  id: z.string(),
  simulationId: z.string(),
  name: z.string(),
  agentType: AgentTypeSchema,
  
  // For LLM agents
  modelId: z.string().optional(),
  modelConfig: z.record(z.unknown()).optional(),
  
  // Epistemic isolation
  viewFilterId: z.string().optional(),  // Which variables/events this agent can see
  
  // State
  isActive: z.boolean(),
  joinedAtFrame: z.number(),
  exitedAtFrame: z.number().optional(),
  
  // For cross-session analysis
  agentProfileId: z.string().optional(),  // Links sessions across simulations
  
  metadata: z.record(z.unknown()).optional()
});
export type AgentSlot = z.infer<typeof AgentSlotSchema>;

/**
 * AgentProfile aggregates behavior across sessions for SAE analysis.
 * This is where we track "how does experience in storyworld X
 * influence behavior in storyworld Y?"
 */
export const AgentProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  modelId: z.string().optional(),
  
  // Aggregate stats
  totalSessions: z.number(),
  totalChoices: z.number(),
  
  // Session history (for causal analysis)
  sessionHistory: z.array(z.object({
    sessionId: z.string(),
    simulationId: z.string(),
    storyworldId: z.string(),
    completedAt: z.date(),
    endingsReached: z.array(z.string()),
    metrics: z.record(z.number()).optional()
  })),
  
  // Behavioral embeddings (for SAE)
  behaviorEmbedding: z.array(z.number()).optional(),
  
  // Analysis metadata
  lastAnalyzedAt: z.date().optional(),
  analysisVersion: z.string().optional()
});
export type AgentProfile = z.infer<typeof AgentProfileSchema>;

// ============================================================================
// Simulation - A Multi-Agent Run
// ============================================================================

export const SimulationStatusSchema = z.enum([
  'INITIALIZING',  // Setting up agents and storyworld
  'RUNNING',       // Active simulation
  'PAUSED',        // Temporarily halted
  'COMPLETED',     // All agents reached terminal states
  'ABORTED',       // Ended abnormally
  'ANALYZING'      // Post-simulation analysis in progress
]);
export type SimulationStatus = z.infer<typeof SimulationStatusSchema>;

export const SimulationSchema = z.object({
  id: z.string(),
  experimentId: z.string().optional(),
  name: z.string(),
  
  // What storyworld(s) are being simulated
  storyworldIds: z.array(z.string()),
  
  // Participants
  agents: z.array(AgentSlotSchema),
  
  // Progress
  status: SimulationStatusSchema,
  currentFrame: z.number(),
  
  // Configuration
  config: z.object({
    maxFrames: z.number().optional(),
    frameTimeoutMs: z.number().optional(),
    randomSeed: z.number().optional(),
    
    // Epistemic isolation settings
    preventBackchannel: z.boolean().optional(),
    isolateAgentMemory: z.boolean().optional(),
    
    // Analysis hooks
    snapshotInterval: z.number().optional(),
    computeMetricsPerFrame: z.boolean().optional()
  }),
  
  // Timing
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
  
  // Results (populated on completion)
  finalState: z.record(z.unknown()).optional(),
  
  metadata: z.record(z.unknown()).optional()
});
export type Simulation = z.infer<typeof SimulationSchema>;

// ============================================================================
// Unified Event Log
// ============================================================================

/**
 * All events go in one stream, typed by eventType.
 * This replaces separate tables for orders, chat, game_events, etc.
 */
export const EventCategorySchema = z.enum([
  'NARRATIVE',     // Spool/encounter/choice events
  'COMMUNICATION', // Messages between agents
  'STATE',         // Variable changes
  'SYSTEM',        // Simulation lifecycle events
  'ANALYSIS'       // Metrics, snapshots, evaluations
]);
export type EventCategory = z.infer<typeof EventCategorySchema>;

export const SimulationEventSchema = z.object({
  id: z.string(),
  simulationId: z.string(),
  frame: z.number(),
  stage: FrameStageSchema,
  
  category: EventCategorySchema,
  eventType: z.string(),  // Specific event type within category
  
  // Who/what is involved
  actorId: z.string().optional(),      // Agent who caused this
  targetId: z.string().optional(),     // Agent affected (for messages, etc.)
  
  // What happened
  payload: z.record(z.unknown()),
  
  // For analysis
  isVisible: z.record(z.string(), z.boolean()).optional(),  // Which agents can see this
  
  timestamp: z.date()
});
export type SimulationEvent = z.infer<typeof SimulationEventSchema>;

// ============================================================================
// State Snapshots - For Replay and Analysis
// ============================================================================

export const StateSnapshotSchema = z.object({
  id: z.string(),
  simulationId: z.string(),
  frame: z.number(),
  
  // Complete world state
  variableStates: z.array(z.object({
    variableId: z.string(),
    value: z.unknown()
  })),
  
  // Per-agent state
  agentStates: z.array(z.object({
    agentId: z.string(),
    activeSpools: z.array(z.string()),
    currentEncounter: z.string().optional(),
    privateMemory: z.record(z.unknown()).optional()
  })),
  
  // Computed metrics at this point
  metrics: z.record(z.number()).optional(),
  
  createdAt: z.date()
});
export type StateSnapshot = z.infer<typeof StateSnapshotSchema>;

// ============================================================================
// Inter-Agent Communication (Epistemically Bounded)
// ============================================================================

/**
 * Messages are how agents communicate within the narrative.
 * They're filtered through the epistemic isolation layer.
 */
export const MessageChannelSchema = z.enum([
  'NARRATIVE',     // In-world dialogue (part of storyworld)
  'META',          // Out-of-world coordination (if allowed)
  'SYSTEM'         // System notifications
]);
export type MessageChannel = z.infer<typeof MessageChannelSchema>;

export const AgentMessageSchema = z.object({
  id: z.string(),
  simulationId: z.string(),
  frame: z.number(),
  
  senderId: z.string(),
  recipientId: z.string().optional(),  // null = broadcast
  channel: MessageChannelSchema,
  
  // The message itself
  content: z.string(),
  contentType: z.enum(['TEXT', 'JSON', 'ACTION']),
  
  // Narrative context
  encounterId: z.string().optional(),
  spoolId: z.string().optional(),
  
  // Delivery status
  deliveredAtFrame: z.number().optional(),
  readByRecipient: z.boolean().optional(),
  
  metadata: z.record(z.unknown()).optional(),
  sentAt: z.date()
});
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

// ============================================================================
// Analysis Artifacts
// ============================================================================

/**
 * Artifacts produced during or after simulation for research analysis.
 */
export const AnalysisArtifactTypeSchema = z.enum([
  'SESSION_OUTCOME',       // Complete session data
  'CHOICE_DISTRIBUTION',   // How choices were made
  'VARIABLE_TRAJECTORY',   // How variables evolved
  'SPOOL_COMPLETION_RATE', // Which spools completed
  'EMBEDDING_SNAPSHOT',    // Agent behavior embeddings
  'SAE_FEATURES',          // Sparse autoencoder features
  'CROSS_SESSION_DELTA'    // Changes between sessions
]);
export type AnalysisArtifactType = z.infer<typeof AnalysisArtifactTypeSchema>;

export const AnalysisArtifactSchema = z.object({
  id: z.string(),
  simulationId: z.string(),
  experimentId: z.string().optional(),
  
  artifactType: AnalysisArtifactTypeSchema,
  
  // What this artifact contains
  data: z.record(z.unknown()),
  
  // For SAE analysis
  agentProfileId: z.string().optional(),
  sessionIds: z.array(z.string()).optional(),
  
  // Versioning
  analysisVersion: z.string(),
  createdAt: z.date()
});
export type AnalysisArtifact = z.infer<typeof AnalysisArtifactSchema>;
