/**
 * StoryForge - Experiment Tracking
 * 
 * MLFlow-compatible tracking for narrative simulation experiments.
 * Tracks sessions, choice distributions, and cross-session metrics for SAE analysis.
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import { SessionOutcome } from '../narrative/types.js';
import { Simulation, AgentProfile } from '../core/types.js';

// ============================================================================
// Tracking Types
// ============================================================================

export type RunStatus = 'RUNNING' | 'FINISHED' | 'FAILED' | 'KILLED';

export interface ExperimentConfig {
  trackingUri?: string;
  experimentName: string;
  defaultTags?: Record<string, string>;
  artifactLocation?: string;
}

// ============================================================================
// Local File Tracker (MLFlow-compatible format)
// ============================================================================

export class NarrativeTracker {
  private rootDir: string;
  private experimentId: string | null = null;
  private experimentName: string;
  private activeRuns: Map<string, string> = new Map();
  private defaultTags: Record<string, string>;

  constructor(config: ExperimentConfig) {
    this.rootDir = config.trackingUri?.replace('file://', '') ?? './mlruns';
    this.experimentName = config.experimentName;
    this.defaultTags = config.defaultTags ?? {};

    if (!fs.existsSync(this.rootDir)) {
      fs.mkdirSync(this.rootDir, { recursive: true });
    }
  }

  async initialize(): Promise<void> {
    const nameMapPath = path.join(this.rootDir, '_experiments.json');
    let experiments: Record<string, string> = {};
    
    if (fs.existsSync(nameMapPath)) {
      experiments = JSON.parse(fs.readFileSync(nameMapPath, 'utf-8'));
    }

    if (experiments[this.experimentName]) {
      this.experimentId = experiments[this.experimentName];
    } else {
      this.experimentId = uuid().replace(/-/g, '').slice(0, 16);
      experiments[this.experimentName] = this.experimentId;
      fs.writeFileSync(nameMapPath, JSON.stringify(experiments, null, 2));

      const expDir = path.join(this.rootDir, this.experimentId);
      fs.mkdirSync(expDir, { recursive: true });
      fs.writeFileSync(path.join(expDir, 'meta.json'), JSON.stringify({
        experiment_id: this.experimentId,
        name: this.experimentName,
        created_at: new Date().toISOString()
      }, null, 2));
    }
  }

  async startRun(simulation: Simulation): Promise<string> {
    if (!this.experimentId) await this.initialize();

    const runId = uuid().replace(/-/g, '');
    const runDir = path.join(this.rootDir, this.experimentId!, runId);

    fs.mkdirSync(runDir, { recursive: true });
    fs.mkdirSync(path.join(runDir, 'artifacts'), { recursive: true });
    fs.mkdirSync(path.join(runDir, 'metrics'), { recursive: true });
    fs.mkdirSync(path.join(runDir, 'params'), { recursive: true });
    fs.mkdirSync(path.join(runDir, 'tags'), { recursive: true });

    fs.writeFileSync(path.join(runDir, 'meta.json'), JSON.stringify({
      run_id: runId,
      experiment_id: this.experimentId,
      simulation_id: simulation.id,
      status: 'RUNNING',
      start_time: Date.now()
    }, null, 2));

    await this.logParam(runId, 'simulation.name', simulation.name);
    await this.logParam(runId, 'simulation.storyworld_count', String(simulation.storyworldIds.length));
    await this.logParam(runId, 'simulation.agent_count', String(simulation.agents.length));

    for (let i = 0; i < simulation.agents.length; i++) {
      const agent = simulation.agents[i];
      await this.logParam(runId, `agent.${i}.id`, agent.id);
      await this.logParam(runId, `agent.${i}.name`, agent.name);
      await this.logParam(runId, `agent.${i}.type`, agent.agentType);
      if (agent.modelId) {
        await this.logParam(runId, `agent.${i}.model`, agent.modelId);
      }
    }

    for (const [key, value] of Object.entries(this.defaultTags)) {
      await this.setTag(runId, key, value);
    }
    await this.setTag(runId, 'simulation_id', simulation.id);

    this.activeRuns.set(simulation.id, runId);
    return runId;
  }

  async endRun(simulationId: string, status: RunStatus = 'FINISHED'): Promise<void> {
    const runId = this.activeRuns.get(simulationId);
    if (!runId) return;

    const runDir = path.join(this.rootDir, this.experimentId!, runId);
    const metaPath = path.join(runDir, 'meta.json');

    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      meta.status = status;
      meta.end_time = Date.now();
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }

    this.activeRuns.delete(simulationId);
  }

  async logMetric(runId: string, key: string, value: number, step?: number): Promise<void> {
    const runDir = this.findRunDir(runId);
    if (!runDir) return;

    const metricsFile = path.join(runDir, 'metrics', key.replace(/\./g, '_'));
    const entry = `${Date.now()} ${value} ${step ?? 0}\n`;
    fs.appendFileSync(metricsFile, entry);
  }

  async logMetrics(simulationId: string, metrics: Record<string, number>, step?: number): Promise<void> {
    const runId = this.activeRuns.get(simulationId);
    if (!runId) return;

    for (const [key, value] of Object.entries(metrics)) {
      await this.logMetric(runId, key, value, step);
    }
  }

  async logParam(runId: string, key: string, value: string): Promise<void> {
    const runDir = this.findRunDir(runId);
    if (!runDir) return;
    fs.writeFileSync(path.join(runDir, 'params', key.replace(/\./g, '_')), value);
  }

  async setTag(runId: string, key: string, value: string): Promise<void> {
    const runDir = this.findRunDir(runId);
    if (!runDir) return;
    fs.writeFileSync(path.join(runDir, 'tags', key.replace(/\./g, '_')), value);
  }

  /**
   * Log a complete session outcome for SAE analysis.
   */
  async logSessionOutcome(simulationId: string, outcome: SessionOutcome): Promise<void> {
    const runId = this.activeRuns.get(simulationId);
    if (!runId) return;

    const runDir = this.findRunDir(runId);
    if (!runDir) return;

    const sessionsDir = path.join(runDir, 'artifacts', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, `${outcome.sessionId}.json`),
      JSON.stringify(outcome, null, 2)
    );

    await this.logMetric(runId, `session.${outcome.agentId}.total_choices`, outcome.totalChoices);
    await this.logMetric(runId, `session.${outcome.agentId}.spools_entered`, outcome.spoolsEntered.length);
    await this.logMetric(runId, `session.${outcome.agentId}.spools_completed`, outcome.spoolsCompleted.length);

    const choiceDistribution = this.computeChoiceDistribution(outcome);
    fs.writeFileSync(
      path.join(runDir, 'artifacts', `choice_dist_${outcome.agentId}.json`),
      JSON.stringify(choiceDistribution, null, 2)
    );
  }

  private computeChoiceDistribution(outcome: SessionOutcome): {
    totalChoices: number;
    byEncounter: Record<string, { chosen: string; available: string[]; index: number }>;
    positionBias: number[];
  } {
    const byEncounter: Record<string, { chosen: string; available: string[]; index: number }> = {};
    const positionCounts: number[] = [];

    for (const choice of outcome.choiceSequence) {
      byEncounter[choice.encounterId] = {
        chosen: choice.choiceId,
        available: choice.availableChoices,
        index: choice.choiceIndex
      };

      while (positionCounts.length <= choice.choiceIndex) {
        positionCounts.push(0);
      }
      positionCounts[choice.choiceIndex]++;
    }

    const total = outcome.choiceSequence.length;
    const positionBias = positionCounts.map(c => c / Math.max(total, 1));

    return { totalChoices: total, byEncounter, positionBias };
  }

  /**
   * Log cross-session delta for tracking behavioral changes.
   */
  async logCrossSessionDelta(
    simulationId: string,
    agentId: string,
    currentSession: SessionOutcome,
    priorSession: SessionOutcome
  ): Promise<void> {
    const runId = this.activeRuns.get(simulationId);
    if (!runId) return;

    const runDir = this.findRunDir(runId);
    if (!runDir) return;

    const divergence = this.computeChoiceDivergence(currentSession, priorSession);

    const delta = {
      agentId,
      currentSessionId: currentSession.sessionId,
      priorSessionId: priorSession.sessionId,
      choiceCountDelta: currentSession.totalChoices - priorSession.totalChoices,
      spoolCompletionDelta: currentSession.spoolsCompleted.length - priorSession.spoolsCompleted.length,
      newSpoolsEntered: currentSession.spoolsEntered.filter(s => !priorSession.spoolsEntered.includes(s)),
      newSpoolsCompleted: currentSession.spoolsCompleted.filter(s => !priorSession.spoolsCompleted.includes(s)),
      newEndings: currentSession.endingsReached.filter(e => !priorSession.endingsReached.includes(e)),
      choiceDivergence: divergence
    };

    const deltaDir = path.join(runDir, 'artifacts', 'deltas');
    fs.mkdirSync(deltaDir, { recursive: true });
    fs.writeFileSync(
      path.join(deltaDir, `${agentId}_${currentSession.sessionId}.json`),
      JSON.stringify(delta, null, 2)
    );

    await this.logMetric(runId, `delta.${agentId}.choice_count`, delta.choiceCountDelta);
    await this.logMetric(runId, `delta.${agentId}.divergence_rate`, divergence.divergenceRate);
  }

  private computeChoiceDivergence(
    current: SessionOutcome,
    prior: SessionOutcome
  ): { divergentCount: number; sharedEncounters: number; divergenceRate: number } {
    const priorChoices = new Map(prior.choiceSequence.map(c => [c.encounterId, c.choiceId]));

    let sharedEncounters = 0;
    let divergentCount = 0;

    for (const choice of current.choiceSequence) {
      const priorChoice = priorChoices.get(choice.encounterId);
      if (priorChoice !== undefined) {
        sharedEncounters++;
        if (priorChoice !== choice.choiceId) divergentCount++;
      }
    }

    return {
      divergentCount,
      sharedEncounters,
      divergenceRate: sharedEncounters > 0 ? divergentCount / sharedEncounters : 0
    };
  }

  async updateAgentProfile(profile: AgentProfile, session: SessionOutcome): Promise<AgentProfile> {
    const updated: AgentProfile = {
      ...profile,
      totalSessions: profile.totalSessions + 1,
      totalChoices: profile.totalChoices + session.totalChoices,
      sessionHistory: [
        ...profile.sessionHistory,
        {
          sessionId: session.sessionId,
          simulationId: session.simulationId,
          storyworldId: session.storyworldId,
          completedAt: new Date(),
          endingsReached: session.endingsReached,
          metrics: session.metrics
        }
      ]
    };

    const profilesDir = path.join(this.rootDir, '_profiles');
    fs.mkdirSync(profilesDir, { recursive: true });
    fs.writeFileSync(path.join(profilesDir, `${profile.id}.json`), JSON.stringify(updated, null, 2));

    return updated;
  }

  loadAgentProfile(profileId: string): AgentProfile | null {
    const profilePath = path.join(this.rootDir, '_profiles', `${profileId}.json`);
    if (!fs.existsSync(profilePath)) return null;
    return JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
  }

  async logArtifactData(simulationId: string, artifactName: string, data: unknown): Promise<void> {
    const runId = this.activeRuns.get(simulationId);
    if (!runId) return;

    const runDir = this.findRunDir(runId);
    if (!runDir) return;

    const artifactPath = path.join(runDir, 'artifacts', artifactName);
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, JSON.stringify(data, null, 2));
  }

  private findRunDir(runId: string): string | null {
    if (!this.experimentId) return null;
    const runDir = path.join(this.rootDir, this.experimentId, runId);
    return fs.existsSync(runDir) ? runDir : null;
  }

  getRunId(simulationId: string): string | undefined {
    return this.activeRuns.get(simulationId);
  }
}

// ============================================================================
// SAE Feature Extractor
// ============================================================================

export class SAEFeatureExtractor {
  /**
   * Extract feature vector from a session outcome for SAE training.
   */
  extractFeatures(outcome: SessionOutcome): number[] {
    const features: number[] = [];

    features.push(outcome.totalChoices);
    features.push(outcome.spoolsEntered.length);
    features.push(outcome.spoolsCompleted.length);
    features.push(outcome.endingsReached.length);
    features.push(outcome.endFrame - outcome.startFrame);

    const completionRate = outcome.spoolsEntered.length > 0
      ? outcome.spoolsCompleted.length / outcome.spoolsEntered.length
      : 0;
    features.push(completionRate);

    const positionCounts = new Array(5).fill(0);
    for (const choice of outcome.choiceSequence) {
      if (choice.choiceIndex < positionCounts.length) {
        positionCounts[choice.choiceIndex]++;
      }
    }
    const total = outcome.choiceSequence.length || 1;
    for (const count of positionCounts) {
      features.push(count / total);
    }

    const avgAvailable = outcome.choiceSequence.length > 0
      ? outcome.choiceSequence.reduce((sum, c) => sum + c.availableChoices.length, 0) / outcome.choiceSequence.length
      : 0;
    features.push(avgAvailable);

    const choiceCounts = new Map<string, number>();
    for (const choice of outcome.choiceSequence) {
      choiceCounts.set(choice.choiceId, (choiceCounts.get(choice.choiceId) ?? 0) + 1);
    }
    let entropy = 0;
    for (const count of choiceCounts.values()) {
      const p = count / total;
      if (p > 0) entropy -= p * Math.log2(p);
    }
    features.push(entropy);

    return features;
  }

  extractDeltaFeatures(current: SessionOutcome, prior: SessionOutcome): number[] {
    const currentFeatures = this.extractFeatures(current);
    const priorFeatures = this.extractFeatures(prior);
    const deltaFeatures = currentFeatures.map((f, i) => f - priorFeatures[i]);
    return [...currentFeatures, ...priorFeatures, ...deltaFeatures];
  }

  getFeatureNames(): string[] {
    return [
      'total_choices', 'spools_entered', 'spools_completed', 'endings_reached',
      'duration_frames', 'completion_rate', 'position_bias_0', 'position_bias_1',
      'position_bias_2', 'position_bias_3', 'position_bias_4', 'avg_choices_available',
      'choice_entropy'
    ];
  }
}
