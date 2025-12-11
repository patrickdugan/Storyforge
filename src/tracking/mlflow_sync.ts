/**
 * StoryForge – MLflow-Compatible Tracking Layer
 * 
 * Writes run metadata, metrics, params, and artifacts in the
 * MLflow directory structure:
 *
 *   mlruns/
 *     <experiment_id>/
 *       <run_id>/
 *         meta.yaml
 *         params/
 *         metrics/
 *         artifacts/
 */

import * as fs from "fs";
import * as path from "path";
import { v4 as uuid } from "uuid";

export interface TrackingEvent {
  frame: number;
  agent: string;
  action: string;
  hrm_vector?: number[];
  features?: { feature_id: number; value: number }[];
}

export class MLFlowTracker {
  baseDir: string;
  expId: string;
  runId: string;
  runDir: string;

  constructor(experimentName: string) {
    this.baseDir = path.join(process.cwd(), "mlruns");

    this.expId = "0"; // default experiment
    const expDir = path.join(this.baseDir, this.expId);
    if (!fs.existsSync(expDir)) fs.mkdirSync(expDir, { recursive: true });

    this.runId = uuid().replace(/-/g, "");
    this.runDir = path.join(expDir, this.runId);
    fs.mkdirSync(this.runDir, { recursive: true });

    // MLflow metadata
    fs.writeFileSync(
      path.join(this.runDir, "meta.yaml"),
      `run_id: ${this.runId}
experiment_id: ${this.expId}
artifact_uri: ${this.runDir}/artifacts
lifecycle_stage: active
start_time: ${Date.now()}
status: RUNNING
user_id: storyforge
tags:
  experiment_name: ${experimentName}
`
    );

    fs.mkdirSync(path.join(this.runDir, "metrics"), { recursive: true });
    fs.mkdirSync(path.join(this.runDir, "params"), { recursive: true });
    fs.mkdirSync(path.join(this.runDir, "artifacts"), { recursive: true });
  }

  logParam(name: string, value: string | number) {
    const p = path.join(this.runDir, "params", name);
    fs.writeFileSync(p, String(value));
  }

  logMetric(name: string, step: number, value: number) {
    const m = path.join(this.runDir, "metrics", name);
    fs.appendFileSync(m, `${step} ${value} ${Date.now()}\n`);
  }

  logArtifact(name: string, data: string | Buffer) {
    const a = path.join(this.runDir, "artifacts", name);
    fs.writeFileSync(a, data);
  }

  logEvent(e: TrackingEvent) {
    this.logMetric("frame_index", e.frame, e.frame);

    if (e.features) {
      for (const f of e.features) {
        this.logMetric(`feat_${f.feature_id}`, e.frame, f.value);
      }
    }

    if (e.hrm_vector) {
      e.hrm_vector.forEach((v, i) =>
        this.logMetric(`hrm_${i}`, e.frame, v)
      );
    }

    this.logArtifact(
      `actions/frame_${e.frame}.json`,
      JSON.stringify(e, null, 2)
    );
  }

  endRun() {
    const meta = path.join(this.runDir, "meta.yaml");
    const contents = fs.readFileSync(meta, "utf8");
    fs.writeFileSync(
      meta,
      contents.replace("status: RUNNING", "status: FINISHED")
    );
  }
}
