/**
 * StoryForge - Neural Capture Service
 * 
 * Runtime service for capturing SAE features during simulation.
 * The "EEG machine" that records model representations.
 */

import { v4 as uuid } from 'uuid';
import {
  NeuralSnapshot,
  SAEConfig,
  CaptureConfig,
  SessionNeuralProfile,
  FeatureTrajectory,
  CrossSessionNeuralDelta,
  RepresentationType
} from './types.js';

// ============================================================================
// SAE Interface - Implement for your specific SAE
// ============================================================================

/**
 * Interface for sparse autoencoder.
 * Implement this with your actual SAE model.
 */
export interface SAEEncoder {
  readonly config: SAEConfig;
  
  /**
   * Encode a dense representation into sparse features.
   * Returns map of featureIndex -> activation.
   */
  encode(representation: number[]): Map<number, number>;
  
  /**
   * Get top-K active features.
   */
  topK(representation: number[], k: number): { index: number; activation: number }[];
  
  /**
   * Get feature label if available.
   */
  getFeatureLabel(index: number): string | undefined;
}

// ============================================================================
// Representation Extractor Interface
// ============================================================================

/**
 * Interface for extracting representations from model calls.
 * Implement based on your model access (API embeddings, local weights, etc.)
 */
export interface RepresentationExtractor {
  /**
   * Extract representation from a model call.
   */
  extract(params: {
    modelId: string;
    prompt: string;
    response: string;
    representationType: RepresentationType;
    layer?: string;
  }): Promise<number[]>;
}

// ============================================================================
// Mock Implementations (for testing)
// ============================================================================

export class MockSAEEncoder implements SAEEncoder {
  config: SAEConfig;
  
  constructor(config: Partial<SAEConfig> = {}) {
    this.config = {
      id: config.id ?? 'mock-sae',
      name: config.name ?? 'Mock SAE',
      version: config.version ?? '1.0',
      inputDim: config.inputDim ?? 768,
      hiddenDim: config.hiddenDim ?? 4096,
      trainedOn: config.trainedOn ?? {
        modelId: 'mock-model',
        representationType: 'EMBEDDING'
      }
    };
  }
  
  encode(representation: number[]): Map<number, number> {
    // Mock: return random sparse features
    const features = new Map<number, number>();
    const numActive = Math.floor(Math.random() * 50) + 10;
    
    for (let i = 0; i < numActive; i++) {
      const idx = Math.floor(Math.random() * this.config.hiddenDim);
      const activation = Math.random() * 2;
      features.set(idx, activation);
    }
    
    return features;
  }
  
  topK(representation: number[], k: number): { index: number; activation: number }[] {
    const features = this.encode(representation);
    const sorted = Array.from(features.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, k);
    
    return sorted.map(([index, activation]) => ({ index, activation }));
  }
  
  getFeatureLabel(index: number): string | undefined {
    return this.config.featureLabels?.[String(index)];
  }
}

export class MockRepresentationExtractor implements RepresentationExtractor {
  async extract(params: {
    modelId: string;
    prompt: string;
    response: string;
    representationType: RepresentationType;
  }): Promise<number[]> {
    // Mock: return random embedding
    const dim = 768;
    return Array.from({ length: dim }, () => Math.random() * 2 - 1);
  }
}

// ============================================================================
// Neural Capture Service
// ============================================================================

export class NeuralCaptureService {
  private sae: SAEEncoder;
  private extractor: RepresentationExtractor;
  private config: CaptureConfig;
  private snapshots: NeuralSnapshot[] = [];
  private trajectories: Map<string, FeatureTrajectory> = new Map();

  constructor(
    sae: SAEEncoder,
    extractor: RepresentationExtractor,
    config: Partial<CaptureConfig> = {}
  ) {
    this.sae = sae;
    this.extractor = extractor;
    this.config = {
      captureOnChoice: config.captureOnChoice ?? true,
      captureOnAction: config.captureOnAction ?? true,
      capturePerFrame: config.capturePerFrame ?? false,
      captureInterval: config.captureInterval,
      representationType: config.representationType ?? 'EMBEDDING',
      sourceLayer: config.sourceLayer,
      saeId: config.saeId ?? sae.config.id,
      topK: config.topK ?? 32,
      activationThreshold: config.activationThreshold ?? 0.1,
      storeFullVector: config.storeFullVector ?? false,
      storeSparseOnly: config.storeSparseOnly ?? true
    };
  }

  /**
   * Capture neural snapshot for a model call.
   */
  async capture(params: {
    simulationId: string;
    frameId: number;
    agentId: string;
    modelId: string;
    prompt: string;
    response: string;
    context: NeuralSnapshot['context'];
  }): Promise<NeuralSnapshot> {
    // Extract representation
    const representation = await this.extractor.extract({
      modelId: params.modelId,
      prompt: params.prompt,
      response: params.response,
      representationType: this.config.representationType,
      layer: this.config.sourceLayer
    });

    // Encode through SAE
    const features = this.sae.encode(representation);
    const topK = this.sae.topK(representation, this.config.topK);

    // Filter by threshold
    const activeFeatures: Record<string, number> = {};
    let totalActivation = 0;
    let maxActivation = 0;
    
    for (const [idx, activation] of features) {
      if (activation >= (this.config.activationThreshold ?? 0)) {
        activeFeatures[String(idx)] = activation;
        totalActivation += activation;
        maxActivation = Math.max(maxActivation, activation);
      }
    }

    const sparsity = Object.keys(activeFeatures).length / this.sae.config.hiddenDim;

    // Build snapshot
    const snapshot: NeuralSnapshot = {
      id: uuid(),
      simulationId: params.simulationId,
      frameId: params.frameId,
      agentId: params.agentId,
      modelId: params.modelId,
      representationType: this.config.representationType,
      sourceLayer: this.config.sourceLayer,
      saeId: this.config.saeId,
      activeFeatures,
      topK: topK.map(f => ({
        featureIndex: f.index,
        activation: f.activation,
        label: this.sae.getFeatureLabel(f.index)
      })),
      sparsity,
      totalActivation,
      maxActivation,
      context: params.context,
      capturedAt: new Date()
    };

    this.snapshots.push(snapshot);
    this.updateTrajectories(snapshot);

    return snapshot;
  }

  /**
   * Update feature trajectories with new snapshot.
   */
  private updateTrajectories(snapshot: NeuralSnapshot): void {
    for (const [idxStr, activation] of Object.entries(snapshot.activeFeatures)) {
      const key = `${snapshot.simulationId}:${snapshot.agentId}:${idxStr}`;
      
      let trajectory = this.trajectories.get(key);
      if (!trajectory) {
        trajectory = {
          simulationId: snapshot.simulationId,
          agentId: snapshot.agentId,
          saeId: snapshot.saeId,
          featureIndex: parseInt(idxStr),
          featureLabel: this.sae.getFeatureLabel(parseInt(idxStr)),
          trajectory: [],
          meanActivation: 0,
          maxActivation: 0,
          activationFrequency: 0
        };
        this.trajectories.set(key, trajectory);
      }

      trajectory.trajectory.push({
        frameId: snapshot.frameId,
        activation,
        context: snapshot.context.choiceMade ?? snapshot.context.actionTaken
      });

      // Update stats
      const activations = trajectory.trajectory.map(t => t.activation);
      trajectory.meanActivation = activations.reduce((a, b) => a + b, 0) / activations.length;
      trajectory.maxActivation = Math.max(...activations);
    }
  }

  /**
   * Get all snapshots for a simulation.
   */
  getSnapshots(simulationId: string): NeuralSnapshot[] {
    return this.snapshots.filter(s => s.simulationId === simulationId);
  }

  /**
   * Get snapshots for a specific agent.
   */
  getAgentSnapshots(simulationId: string, agentId: string): NeuralSnapshot[] {
    return this.snapshots.filter(
      s => s.simulationId === simulationId && s.agentId === agentId
    );
  }

  /**
   * Get feature trajectory.
   */
  getTrajectory(simulationId: string, agentId: string, featureIndex: number): FeatureTrajectory | undefined {
    const key = `${simulationId}:${agentId}:${featureIndex}`;
    return this.trajectories.get(key);
  }

  /**
   * Compute session neural profile from snapshots.
   */
  computeSessionProfile(
    sessionId: string,
    simulationId: string,
    agentId: string
  ): SessionNeuralProfile {
    const snapshots = this.getAgentSnapshots(simulationId, agentId);
    
    // Aggregate features
    const featureSums = new Map<string, number>();
    const featureCounts = new Map<string, number>();
    const featureSquares = new Map<string, number>();
    
    for (const snapshot of snapshots) {
      for (const [idx, activation] of Object.entries(snapshot.activeFeatures)) {
        featureSums.set(idx, (featureSums.get(idx) ?? 0) + activation);
        featureCounts.set(idx, (featureCounts.get(idx) ?? 0) + 1);
        featureSquares.set(idx, (featureSquares.get(idx) ?? 0) + activation * activation);
      }
    }

    const n = snapshots.length;
    const meanFeatures: Record<string, number> = {};
    const featureVariance: Record<string, number> = {};
    
    for (const [idx, sum] of featureSums) {
      const mean = sum / n;
      meanFeatures[idx] = mean;
      
      const sqSum = featureSquares.get(idx) ?? 0;
      featureVariance[idx] = (sqSum / n) - (mean * mean);
    }

    // Find dominant features
    const dominantFeatures = Object.entries(meanFeatures)
      .filter(([_, mean]) => mean > 0.5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([idx, mean]) => ({
        featureIndex: parseInt(idx),
        meanActivation: mean,
        frequency: (featureCounts.get(idx) ?? 0) / n
      }));

    return {
      sessionId,
      simulationId,
      agentId,
      saeId: this.config.saeId,
      meanFeatures,
      featureVariance,
      dominantFeatures,
      transientFeatures: [],  // Would need more analysis
      featureDrift: [],       // Would need temporal analysis
      computedAt: new Date()
    };
  }

  /**
   * Compute cross-session neural delta.
   */
  computeCrossSessionDelta(
    agentProfileId: string,
    priorProfile: SessionNeuralProfile,
    currentProfile: SessionNeuralProfile
  ): CrossSessionNeuralDelta {
    const featureDeltas: CrossSessionNeuralDelta['featureDeltas'] = [];
    
    // Get all features from both sessions
    const allFeatures = new Set([
      ...Object.keys(priorProfile.meanFeatures),
      ...Object.keys(currentProfile.meanFeatures)
    ]);

    for (const idx of allFeatures) {
      const priorMean = priorProfile.meanFeatures[idx] ?? 0;
      const currentMean = currentProfile.meanFeatures[idx] ?? 0;
      const delta = currentMean - priorMean;
      
      if (Math.abs(delta) > 0.1) {  // Only significant changes
        featureDeltas.push({
          featureIndex: parseInt(idx),
          priorMean,
          currentMean,
          delta,
          significanceScore: Math.abs(delta)
        });
      }
    }

    // Sort by significance
    featureDeltas.sort((a, b) => b.significanceScore - a.significanceScore);

    // Find emergent and suppressed features
    const emergentFeatures = featureDeltas
      .filter(d => d.priorMean < 0.1 && d.currentMean > 0.5)
      .map(d => d.featureIndex);

    const suppressedFeatures = featureDeltas
      .filter(d => d.priorMean > 0.5 && d.currentMean < 0.1)
      .map(d => d.featureIndex);

    return {
      agentProfileId,
      priorSessionId: priorProfile.sessionId,
      currentSessionId: currentProfile.sessionId,
      saeId: this.config.saeId,
      featureDeltas,
      emergentFeatures,
      suppressedFeatures,
      computedAt: new Date()
    };
  }

  /**
   * Clear snapshots (for memory management).
   */
  clearSnapshots(): void {
    this.snapshots = [];
    this.trajectories.clear();
  }

  /**
   * Get SAE config.
   */
  getSAEConfig(): SAEConfig {
    return this.sae.config;
  }
}
