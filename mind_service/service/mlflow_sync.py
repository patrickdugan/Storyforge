import os
import mlflow
import yaml
import time

MLRUNS_DIR = "./mlruns"

def sync_runs():
    for exp_id in os.listdir(MLRUNS_DIR):
        exp_dir = os.path.join(MLRUNS_DIR, exp_id)
        if not os.path.isdir(exp_dir):
            continue

        for run_id in os.listdir(exp_dir):
            run_dir = os.path.join(exp_dir, run_id)
            meta = os.path.join(run_dir, "meta.yaml")

            if not os.path.exists(meta):
                continue

            with open(meta, "r") as f:
                meta_doc = yaml.safe_load(f)

            if meta_doc.get("status") != "FINISHED":
                continue

            print(f"Importing run: {run_id}")
            import_run(run_dir)


def import_run(run_dir):
    # MLflow API import
    mlflow.start_run()

    # Params
    params_dir = os.path.join(run_dir, "params")
    for p in os.listdir(params_dir):
        val = open(os.path.join(params_dir, p)).read().strip()
        mlflow.log_param(p, val)

    # Metrics
    metrics_dir = os.path.join(run_dir, "metrics")
    for m in os.listdir(metrics_dir):
        for line in open(os.path.join(metrics_dir, m)):
            step, value, ts = line.strip().split()
            mlflow.log_metric(m, float(value), int(step))

    # Artifacts
    artifacts_dir = os.path.join(run_dir, "artifacts")
    mlflow.log_artifacts(artifacts_dir)

    mlflow.end_run()
