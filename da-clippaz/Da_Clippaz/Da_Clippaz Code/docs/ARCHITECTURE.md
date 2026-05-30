# Architecture overview

This document provides a brief overview of the architecture for **Da\u00a0Clippaz**.  A more detailed technical specification and runbook will be maintained in our Notion workspace (links will be added once those pages are created).  The primary goal of the architecture is to isolate concerns so that future enhancements – such as highlight detection, scoring or cloud ingestion – can be added without large refactors.

## High‑level components

* **CLI (`daclippaz.cli`)** – entrypoint for the user.  Parses command‑line arguments, loads the configuration, sets up logging and delegates to either the pipeline runner or the directory watcher.

* **Configuration (`daclippaz.config`)** – responsible for reading a JSON configuration file, performing basic validation and returning a configuration object to the rest of the system.

* **Logging (`daclippaz.logging_utils`)** – centralises logging configuration so that the entire application uses consistent log formatting and respects the configured log level.

* **FFmpeg utilities (`daclippaz.ffmpeg_utils`)** – contains helper functions to detect the presence of FFmpeg and, later, to build command strings for cutting, scaling and encoding video segments.

* **Pipeline** – lives under `daclippaz/pipeline/` and contains:
  * `job_model.py` – definitions for job state, status and metadata persistence.
  * `stages.py` – a series of composable stages that operate on a job (e.g. clipping, scoring, exporting).  Future milestones will implement these stages.
  * `runner.py` – orchestrates execution of the stages, updates job state and writes status files and logs.

* **Watcher** – under `daclippaz/watcher/`, watches the input directory for new recordings, creates job folders and queues jobs for processing.  The implementation will be added in a later milestone.

* **Exporters** – under `daclippaz/exporters/`, defines different export formats.  For PR1 we only prepare a TikTok exporter stub (`tiktok.py`).

* **Detectors** – under `daclippaz/detectors/`, placeholder for highlight detection or scoring logic.  These modules will be fleshed out in future milestones.

## Data flow

1. The user runs `python -m daclippaz run` or `python -m daclippaz watch` with a configuration file.
2. The CLI loads and validates the configuration, sets up logging and checks that FFmpeg is available.
3. In **run** mode, the pipeline runner loads any existing job folders from the input directory and executes a series of stages on each job.  In PR1 this runner will simply log a message.
4. In **watch** mode, a file watcher monitors the input directory for new recordings.  When a video file appears, it creates a job folder with a `job.json` and enqueues the job for processing.  Watcher functionality will arrive in PR3.

## Extension points

The architecture is intentionally modular:

* **Stages** – new stages (e.g. highlight detection or caption generation) can be added by creating functions in `stages.py` and updating the runner to call them.
* **Exporters** – to support another platform (e.g. YouTube Shorts), implement a new exporter module under `daclippaz/exporters/` without affecting the core pipeline.
* **Detectors** – highlight scoring or AI‑based detection can be added in the detectors package and invoked from the pipeline stages.

## Notion documentation

The comprehensive technical specification and runbook will live in our Notion workspace.  Once those pages are created, this document will link to them.  The specification will describe the job state machine, configuration schema, stage design, file format conventions and planned future features.  The runbook will cover installation, setup, troubleshooting and developer workflows.
