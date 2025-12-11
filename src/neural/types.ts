/**
 * StoryForge - Neural Snapshot System
 * 
 * "EEG for LLMs" - per-frame capture of model representations
 * for SAE analysis and behavioral interpretability.
 * 
 * Logs sparse feature activations aligned to:
 * - Narrative events (storyworld choices)
 * - Strategy actions (game orders)
 * - Agent states (epistemic views)
 */

import { z } from 'zod';

// ============================================================================
// Representation Types
// ============================================================================

/**
 * What kind of model representation we captured.
 */
export const RepresentationTypeSchema = z.enum([
  'EMBEDDING',           // Final embedding vector
  'LOGITS',              // Output logits/logprobs
  'HIDDEN_STATE',        // Internal layer activation (open models)
  'ATTENTION_PATTERN',   // Attention weights (open models)
  'RESIDUAL_STREAM',     // Residual stream at layer N
  'MLP_OUTPUT',          // MLP layer output
  'DERIVED',             // Computed from other reps
  'EXTERNAL'             // From external analysis tool
]);
export type RepresentationType = z.infer<typeof RepresentationTypeSchema>;

// ============================================================================
// SAE Configuration
// ============================================================================

export const SAEConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  
  // Architecture
  inputDim: z.number().int().positive(),
  hiddenDim: z.number().int().positive(),  // Number of features
  sparsityTarget: z.number().min(0).max(1).optional(),
  
  // What it was trained on
  trainedOn: z.object({
    modelId: z.string(),
    layer: z.string().optional(),
    representationType: RepresentationTypeSchema,
    dataDescription: z.string().optional()
  }),
  
  // Feature metadata (if available)
  featureLabels: z.record(z.string()).optional(),  // featureIdx -> label
  featureClusters: z.record(z.array(z.number())).optional(),  // clusterName -> featureIdxs
  
  metadata: z.record(z.unknown()).optional()
});
export type SAEConfig = z.infer<typeof SAEConfigSchema>;

// ============================================================================
// Neural Snapshot - Per-Frame Model State
// ============================================================================

/**
 * A snapshot of an agent's "neural state" at a specific frame.
 * Contains sparse SAE features, not dense vectors.
 */
export const NeuralSnapshotSchema = z.object({
  id: z.string(),
  simulationId: z.string(),
  frameId: z.number().int().nonnegative(),
  
  // Who
  agentId: z.string(),
  modelId: z.string(),
  
  // What we captured
  representationType: RepresentationTypeSchema,
  sourceLayer: z.string().optional(),  // e.g., "layer_12", "final"
  
  // SAE encoding
  saeId: z.string(),
  
  // Sparse features - the "EEG signal"
  // Map of featureIndex -> activation strength
  activeFeatures: z.record(z.string(), z.number()),
  
  // Top-K for quick analysis
  topK: z.array(z.object({
    featureIndex: z.number(),
    activation: z.number(),
    label: z.string().optional()
  })),
  
  // Aggregate stats
  sparsity: z.number(),          // Fraction of features active
  totalActivation: z.number(),   // Sum of all activations
  maxActivation: z.number(),     // Peak activation
  
  // Context: what was happening when this was captured
  context: z.object({
    // Narrative context
    encounterId: z.string().optional(),
    spoolId: z.string().optional(),
    choiceMade: z.string().optional(),
    
    // Strategy context
    turnIndex: z.number().optional(),
    phaseType: z.string().optional(),
    actionTaken: z.string().optional(),
    
    // Prompt context
    promptHash: z.string().optional(),  // For deduplication
    promptLength: z.number().optional(),
    responseLength: z.number().optional()
  }),
  
  capturedAt: z.date()
});
export type NeuralSnapshot = z.infer<typeof NeuralSnapshotSchema>;

// ============================================================================
// Feature Trajectory - How Features Evolve Over Time
// ============================================================================

/**
 * Track a specific feature's activation across frames.
 */
export const FeatureTrajectorySchema = z.object({
  simulationId: z.string(),
  agentId: z.string(),
  saeId: z.string(),
  featureIndex: z.number(),
  featureLabel: z.string().optional(),
  
  // Time series of activations
  trajectory: z.array(z.object({
    frameId: z.number(),
    activation: z.number(),
    context: z.string().optional()  // Brief context note
  })),
  
  // Statistics
  meanActivation: z.number(),
  maxActivation: z.number(),
  activationFrequency: z.number(),  // Fraction of frames where active
  
  // Correlations with behavior (computed post-hoc)
  behaviorCorrelations: z.record(z.number()).optional()  // behavior -> correlation
});
export type FeatureTrajectory = z.infer<typeof FeatureTrajectorySchema>;

// ============================================================================
// Cross-Agent Feature Comparison
// ============================================================================

/**
 * Compare feature patterns between agents.
 */
export const FeatureComparisonSchema = z.object({
  simulationId: z.string(),
  saeId: z.string(),
  frameRange: z.object({
    start: z.number(),
    end: z.number()
  }),
  
  // Per-agent aggregate features
  agentFeatures: z.record(z.string(), z.object({
    // agentId -> features
    meanFeatures: z.record(z.string(), z.number()),
    dominantFeatures: z.array(z.number()),  // Top features for this agent
    uniqueFeatures: z.array(z.number())     // Features only this agent shows
  })),
  
  // Shared vs divergent
  sharedDominantFeatures: z.array(z.number()),
  divergentFeatures: z.array(z.object({
    featureIndex: z.number(),
    highAgent: z.string(),
    lowAgent: z.string(),
    difference: z.number()
  }))
});
export type FeatureComparison = z.infer<typeof FeatureComparisonSchema>;

// ============================================================================
// Behavioral Feature Mapping
// ============================================================================

/**
 * Map SAE features to observable behaviors.
 * This is the interpretability layer.
 */
export const FeatureBehaviorMapSchema = z.object({
  saeId: z.string(),
  featureIndex: z.number(),
  
  // What behaviors correlate with this feature
  associatedBehaviors: z.array(z.object({
    behaviorType: z.string(),  // 'COOPERATE', 'BETRAY', 'ESCALATE', etc.
    correlation: z.number(),
    sampleSize: z.number(),
    confidence: z.number()
  })),
  
  // What narrative contexts trigger this feature
  narrativeTriggers: z.array(z.object({
    spoolId: z.string().optional(),
    encounterId: z.string().optional(),
    choicePattern: z.string().optional(),
    activationStrength: z.number()
  })),
  
  // Hypothesized interpretation
  interpretation: z.string().optional(),
  interpretationConfidence: z.number().optional()
});
export type FeatureBehaviorMap = z.infer<typeof FeatureBehaviorMapSchema>;

// ============================================================================
// Session Neural Profile
// ============================================================================

/**
 * Aggregate neural profile for an entire session.
 * Used for cross-session SAE analysis.
 */
export const SessionNeuralProfileSchema = z.object({
  sessionId: z.string(),
  simulationId: z.string(),
  agentId: z.string(),
  saeId: z.string(),
  
  // Aggregate features across session
  meanFeatures: z.record(z.string(), z.number()),
  featureVariance: z.record(z.string(), z.number()),
  
  // Dominant features (consistently high)
  dominantFeatures: z.array(z.object({
    featureIndex: z.number(),
    meanActivation: z.number(),
    frequency: z.number()
  })),
  
  // Transient features (spike then fade)
  transientFeatures: z.array(z.object({
    featureIndex: z.number(),
    peakFrame: z.number(),
    peakActivation: z.number(),
    duration: z.number()
  })),
  
  // Feature drift (change over session)
  featureDrift: z.array(z.object({
    featureIndex: z.number(),
    startMean: z.number(),
    endMean: z.number(),
    drift: z.number()  // end - start
  })),
  
  // Behavioral summary
  behavioralProfile: z.record(z.number()).optional(),  // behavior -> strength
  
  computedAt: z.date()
});
export type SessionNeuralProfile = z.infer<typeof SessionNeuralProfileSchema>;

// ============================================================================
// Cross-Session Neural Delta
// ============================================================================

/**
 * How an agent's neural profile changed between sessions.
 * Key for understanding how storyworld experience shapes model behavior.
 */
export const CrossSessionNeuralDeltaSchema = z.object({
  agentProfileId: z.string(),
  priorSessionId: z.string(),
  currentSessionId: z.string(),
  saeId: z.string(),
  
  // Feature deltas
  featureDeltas: z.array(z.object({
    featureIndex: z.number(),
    priorMean: z.number(),
    currentMean: z.number(),
    delta: z.number(),
    significanceScore: z.number()  // How meaningful is this change
  })),
  
  // New dominant features
  emergentFeatures: z.array(z.number()),
  
  // Faded features
  suppressedFeatures: z.array(z.number()),
  
  // Behavioral shift (if detected)
  behavioralShift: z.object({
    priorProfile: z.record(z.number()),
    currentProfile: z.record(z.number()),
    shiftMagnitude: z.number()
  }).optional(),
  
  // Causal hypothesis (what in the prior session caused this?)
  hypothesizedCause: z.object({
    triggerEncounters: z.array(z.string()),
    triggerChoices: z.array(z.string()),
    confidence: z.number()
  }).optional(),
  
  computedAt: z.date()
});
export type CrossSessionNeuralDelta = z.infer<typeof CrossSessionNeuralDeltaSchema>;

// ============================================================================
// Neural Snapshot Capture Config
// ============================================================================

export const CaptureConfigSchema = z.object({
  // When to capture
  captureOnChoice: z.boolean(),
  captureOnAction: z.boolean(),
  capturePerFrame: z.boolean(),
  captureInterval: z.number().optional(),  // Every N frames
  
  // What to capture
  representationType: RepresentationTypeSchema,
  sourceLayer: z.string().optional(),
  
  // SAE config
  saeId: z.string(),
  topK: z.number().int().positive(),
  activationThreshold: z.number().optional(),  // Min activation to log
  
  // Storage
  storeFullVector: z.boolean(),  // Store dense vector (expensive)
  storeSparseOnly: z.boolean()   // Only store non-zero features
});
export type CaptureConfig = z.infer<typeof CaptureConfigSchema>;
