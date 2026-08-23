"""Smart face-tracking reframing for vertical video clips."""

from __future__ import annotations

import logging
import math
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

logger = logging.getLogger(__name__)

DEFAULT_DETECT_EVERY_N_FRAMES = 5
DEFAULT_SMOOTHING_ALPHA = 0.25
DEFAULT_MIN_DETECTION_CONFIDENCE = 0.5
ENV_FACE_MODEL_PATH = "DACLIPPAZ_FACE_MODEL_PATH"
SCENE_MEAN_DIFF_THRESHOLD = 12.0
SCENE_HIST_DIFF_THRESHOLD = 0.35
ZOOM_OUT_FACTOR = 1.50


@dataclass
class FaceTrack:
    """Stores detections that belong to the same face over time."""

    track_id: int
    last_center: Tuple[float, float]
    last_seen_frame: int
    total_area: float = 0.0
    total_height: float = 0.0
    visible_count: int = 0
    current_streak: int = 0
    longest_streak: int = 0
    detections: Dict[int, Tuple[float, float]] = field(default_factory=dict)

    def update(
        self,
        frame_index: int,
        center: Tuple[float, float],
        area: float,
        face_height: float,
        continuity_gap_frames: int,
    ) -> None:
        if self.visible_count > 0 and (frame_index - self.last_seen_frame) <= continuity_gap_frames:
            self.current_streak += 1
        else:
            self.current_streak = 1
        self.longest_streak = max(self.longest_streak, self.current_streak)

        self.last_center = center
        self.last_seen_frame = frame_index
        self.total_area += area
        self.total_height += face_height
        self.visible_count += 1
        self.detections[frame_index] = center

    @property
    def average_area(self) -> float:
        if self.visible_count == 0:
            return 0.0
        return self.total_area / float(self.visible_count)

    @property
    def average_height(self) -> float:
        if self.visible_count == 0:
            return 0.0
        return self.total_height / float(self.visible_count)


def _clamp(value: int, low: int, high: int) -> int:
    if value < low:
        return low
    if value > high:
        return high
    return value


def _compute_scene_signature(frame_bgr):
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, (64, 36), interpolation=cv2.INTER_AREA)
    hist = cv2.calcHist([small], [0], None, [32], [0, 256])
    cv2.normalize(hist, hist)
    return small, hist


def _is_scene_change(prev_small, prev_hist, curr_small, curr_hist) -> bool:
    mean_diff = cv2.mean(cv2.absdiff(prev_small, curr_small))[0]
    hist_diff = cv2.compareHist(prev_hist, curr_hist, cv2.HISTCMP_BHATTACHARYYA)
    return mean_diff >= SCENE_MEAN_DIFF_THRESHOLD or hist_diff >= SCENE_HIST_DIFF_THRESHOLD


def _resolve_face_model_path(tasks_model_path: Optional[str | Path]) -> Path:
    # An explicitly configured path is a statement of intent. Falling back to a
    # bundled model when it is missing means a typo in the config silently
    # renders every clip with a different model than the one asked for.
    for setting, value in (
        ("tiktok.smart_face_model_path", tasks_model_path),
        (ENV_FACE_MODEL_PATH, os.getenv(ENV_FACE_MODEL_PATH, "").strip() or None),
    ):
        if not value:
            continue
        resolved = Path(value).expanduser().resolve()
        if resolved.is_file():
            return resolved
        raise RuntimeError(f"{setting} points at a file that does not exist: {resolved}")

    candidates: List[Path] = []

    # Fallback locations so smart mode works without changing segmentation wiring.
    candidates.extend(
        [
            Path.cwd() / "models" / "face_detector.tflite",
            Path.cwd() / "models" / "face_detector.task",
            Path.cwd() / "models" / "blaze_face_short_range.tflite",
            Path.cwd() / "models" / "blaze_face_short_range.task",
        ]
    )

    for candidate in candidates:
        resolved = candidate.expanduser().resolve()
        if resolved.is_file():
            return resolved

    raise RuntimeError(
        "MediaPipe face model not found. Set tiktok.smart_face_model_path or "
        f"{ENV_FACE_MODEL_PATH} to a valid .task/.tflite file."
    )


def _create_face_detector(
    tasks_model_path: Optional[str | Path],
    min_detection_confidence: float = DEFAULT_MIN_DETECTION_CONFIDENCE,
) -> vision.FaceDetector:
    model_path = _resolve_face_model_path(tasks_model_path)
    logger.info("Using MediaPipe FaceDetector model: %s", model_path)

    options = vision.FaceDetectorOptions(
        base_options=python.BaseOptions(model_asset_path=str(model_path)),
        running_mode=vision.RunningMode.IMAGE,
        min_detection_confidence=min_detection_confidence,
    )
    return vision.FaceDetector.create_from_options(options)


def _detect_faces(
    face_detector: vision.FaceDetector,
    frame_bgr,
) -> List[Tuple[float, float, float, float]]:
    rgb_frame = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
    results = face_detector.detect(mp_image)
    if not results.detections:
        return []

    frame_h, frame_w = frame_bgr.shape[:2]
    largest: Optional[Tuple[float, float, float, float]] = None

    for detection in results.detections:
        bbox = detection.bounding_box
        x = int(bbox.origin_x)
        y = int(bbox.origin_y)
        w = int(bbox.width)
        h = int(bbox.height)

        x1 = _clamp(x, 0, frame_w - 1)
        y1 = _clamp(y, 0, frame_h - 1)
        x2 = _clamp(x + w, 0, frame_w)
        y2 = _clamp(y + h, 0, frame_h)
        box_w = x2 - x1
        box_h = y2 - y1
        if box_w <= 0 or box_h <= 0:
            continue

        area = float(box_w * box_h)
        face_center_x = x1 + (box_w // 2)
        face_center_y = y1 + (box_h // 2)
        candidate = (float(face_center_x), float(face_center_y), area, float(box_h))
        if largest is None or area > largest[2]:
            largest = candidate

    return [largest] if largest is not None else []


def _update_tracks(
    tracks: Dict[int, FaceTrack],
    frame_index: int,
    detections: List[Tuple[float, float, float, float]],
    next_track_id: int,
    detect_every_n_frames: int,
    frame_diagonal: float,
) -> int:
    max_missed_frames = detect_every_n_frames * 4
    continuity_gap_frames = detect_every_n_frames * 2
    match_threshold = frame_diagonal * 0.20

    active_track_ids = [
        track_id
        for track_id, track in tracks.items()
        if (frame_index - track.last_seen_frame) <= max_missed_frames
    ]

    candidate_pairs: List[Tuple[float, int, int]] = []
    for detection_index, (cx, cy, _, _) in enumerate(detections):
        for track_id in active_track_ids:
            track = tracks[track_id]
            dx = cx - track.last_center[0]
            dy = cy - track.last_center[1]
            distance = math.hypot(dx, dy)
            if distance <= match_threshold:
                candidate_pairs.append((distance, detection_index, track_id))

    candidate_pairs.sort(key=lambda item: item[0])
    matched_detections = set()
    matched_tracks = set()

    for _, detection_index, track_id in candidate_pairs:
        if detection_index in matched_detections or track_id in matched_tracks:
            continue
        cx, cy, area, face_height = detections[detection_index]
        tracks[track_id].update(
            frame_index=frame_index,
            center=(cx, cy),
            area=area,
            face_height=face_height,
            continuity_gap_frames=continuity_gap_frames,
        )
        matched_detections.add(detection_index)
        matched_tracks.add(track_id)

    for detection_index, (cx, cy, area, face_height) in enumerate(detections):
        if detection_index in matched_detections:
            continue
        track = FaceTrack(
            track_id=next_track_id,
            last_center=(cx, cy),
            last_seen_frame=frame_index,
        )
        track.update(
            frame_index=frame_index,
            center=(cx, cy),
            area=area,
            face_height=face_height,
            continuity_gap_frames=continuity_gap_frames,
        )
        tracks[next_track_id] = track
        next_track_id += 1

    return next_track_id


def _select_dominant_track(tracks: List[FaceTrack]) -> Optional[FaceTrack]:
    if not tracks:
        return None

    max_average_area = max(track.average_area for track in tracks)
    max_longest_streak = max(track.longest_streak for track in tracks)

    best_track: Optional[FaceTrack] = None
    best_score = -1.0
    for track in tracks:
        area_score = (
            track.average_area / max_average_area if max_average_area > 0.0 else 0.0
        )
        streak_score = (
            float(track.longest_streak) / float(max_longest_streak)
            if max_longest_streak > 0
            else 0.0
        )
        score = (0.65 * area_score) + (0.35 * streak_score)
        if score > best_score:
            best_score = score
            best_track = track
    return best_track


def _interpolate_track_centers(
    total_frames: int,
    track: Optional[FaceTrack],
    default_center: Tuple[float, float],
) -> List[Tuple[float, float]]:
    if total_frames <= 0:
        return []
    if track is None or not track.detections:
        return [default_center] * total_frames

    points = sorted(track.detections.items(), key=lambda item: item[0])
    centers: List[Tuple[float, float]] = [default_center] * total_frames

    first_index, first_center = points[0]
    first_index = _clamp(first_index, 0, total_frames - 1)
    for frame_index in range(0, first_index + 1):
        centers[frame_index] = first_center

    for (start_index, start_center), (end_index, end_center) in zip(points, points[1:]):
        start_index = _clamp(start_index, 0, total_frames - 1)
        end_index = _clamp(end_index, 0, total_frames - 1)
        if end_index <= start_index:
            centers[start_index] = start_center
            continue
        span = float(end_index - start_index)
        for frame_index in range(start_index, end_index + 1):
            t = float(frame_index - start_index) / span
            interp_x = ((1.0 - t) * start_center[0]) + (t * end_center[0])
            interp_y = ((1.0 - t) * start_center[1]) + (t * end_center[1])
            centers[frame_index] = (interp_x, interp_y)

    last_index, last_center = points[-1]
    last_index = _clamp(last_index, 0, total_frames - 1)
    for frame_index in range(last_index, total_frames):
        centers[frame_index] = last_center

    return centers


def _smooth_centers(
    centers: List[Tuple[float, float]],
    alpha: float,
) -> List[Tuple[float, float]]:
    if not centers:
        return centers

    alpha = max(0.0, min(1.0, alpha))
    smoothed: List[Tuple[float, float]] = []

    sx, sy = centers[0]
    for cx, cy in centers:
        sx = (alpha * cx) + ((1.0 - alpha) * sx)
        sy = (alpha * cy) + ((1.0 - alpha) * sy)
        smoothed.append((sx, sy))

    return smoothed


def smart_reframe_segment(
    source_path: Path,
    start_frame: int,
    requested_frames: int,
    frame_w: int,
    frame_h: int,
    width: int,
    height: int,
    detect_every_n_frames: int,
    smoothing_alpha: float,
    tasks_model_path: Optional[str | Path] = None,
) -> Tuple[List[Tuple[int, int, int, int]], int]:
    capture = cv2.VideoCapture(str(source_path))
    if not capture.isOpened():
        return [], 0

    capture.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
    tracks: Dict[int, FaceTrack] = {}
    next_track_id = 1
    processed_frames = 0
    frame_diagonal = math.hypot(float(frame_w), float(frame_h))
    scene_ids: List[int] = []
    current_scene_id = 0
    prev_scene_small = None
    prev_scene_hist = None
    scene_stats: Dict[int, Dict[str, float]] = {}

    face_detector = _create_face_detector(tasks_model_path)
    try:
        while processed_frames < requested_frames:
            ok, frame = capture.read()
            if not ok:
                break
            if processed_frames % detect_every_n_frames == 0:
                curr_scene_small, curr_scene_hist = _compute_scene_signature(frame)
                if prev_scene_small is not None and _is_scene_change(
                    prev_scene_small,
                    prev_scene_hist,
                    curr_scene_small,
                    curr_scene_hist,
                ):
                    current_scene_id += 1
                prev_scene_small = curr_scene_small
                prev_scene_hist = curr_scene_hist

                detections = _detect_faces(face_detector, frame)
                next_track_id = _update_tracks(
                    tracks=tracks,
                    frame_index=processed_frames,
                    detections=detections,
                    next_track_id=next_track_id,
                    detect_every_n_frames=detect_every_n_frames,
                    frame_diagonal=frame_diagonal,
                )
                if detections:
                    cx, cy, _, fh = detections[0]
                    stat = scene_stats.setdefault(
                        current_scene_id,
                        {"sum_x": 0.0, "sum_y": 0.0, "sum_h": 0.0, "count": 0.0},
                    )
                    stat["sum_x"] += cx
                    stat["sum_y"] += cy
                    stat["sum_h"] += fh
                    stat["count"] += 1.0
            scene_ids.append(current_scene_id)
            processed_frames += 1
    finally:
        face_detector.close()
        capture.release()

    if processed_frames <= 0:
        return [], 0

    dominant_track = _select_dominant_track(list(tracks.values()))
    if dominant_track is None:
        logger.info("No faces detected in clip window, using center crop fallback.")

    default_center = (float(frame_w) * 0.5, float(frame_h) * 0.5)
    centers = _interpolate_track_centers(processed_frames, dominant_track, default_center)
    smoothed_centers = _smooth_centers(centers, smoothing_alpha)
    scene_locked_centers: List[Tuple[float, float]] = []
    scene_anchor_by_id: Dict[int, Tuple[float, float]] = {}
    scene_face_detected_by_id: Dict[int, bool] = {}
    scene_face_height_by_id: Dict[int, int] = {}
    for idx, center in enumerate(smoothed_centers):
        scene_id = scene_ids[idx] if idx < len(scene_ids) else 0
        anchor = scene_anchor_by_id.get(scene_id)
        if anchor is None:
            stat = scene_stats.get(scene_id)
            if stat is not None and stat["count"] > 0.0:
                anchor = (
                    stat["sum_x"] / stat["count"],
                    stat["sum_y"] / stat["count"],
                )
                scene_face_detected_by_id[scene_id] = True
                scene_face_height_by_id[scene_id] = int(round(stat["sum_h"] / stat["count"]))
            else:
                anchor = center
                scene_face_detected_by_id[scene_id] = False
                scene_face_height_by_id[scene_id] = 0
            scene_anchor_by_id[scene_id] = anchor
        scene_locked_centers.append(anchor)

    target_ratio = float(width) / float(height)
    crop_h = int(frame_h * 0.85 * ZOOM_OUT_FACTOR)
    crop_w = int(crop_h * target_ratio)
    if crop_w > frame_w:
        crop_w = frame_w
        crop_h = int(crop_w / target_ratio)
    if crop_h > frame_h:
        crop_h = frame_h
        crop_w = int(crop_h * target_ratio)

    crop_w = _clamp(crop_w, 1, frame_w)
    crop_h = _clamp(crop_h, 1, frame_h)

    windows: List[Tuple[int, int, int, int]] = []
    for idx, (cx, smoothed_face_center_y) in enumerate(scene_locked_centers):
        scene_id = scene_ids[idx] if idx < len(scene_ids) else 0
        face_detected = scene_face_detected_by_id.get(scene_id, False)
        face_height = scene_face_height_by_id.get(scene_id, 0)
        if face_detected:
            cy = int(smoothed_face_center_y) - int(face_height * 0.25)
        else:
            cy = frame_h // 2

        x1 = max(0, min(frame_w - crop_w, int(cx - crop_w // 2)))
        y1 = max(0, min(frame_h - crop_h, int(cy - crop_h // 2)))
        windows.append((x1, y1, crop_w, crop_h))

    return windows, processed_frames


def render_smart_vertical_clip(
    source_path: Path,
    output_video_path: Path,
    start_seconds: float,
    duration_seconds: float,
    target_width: int,
    target_height: int,
    detect_every_n_frames: int = DEFAULT_DETECT_EVERY_N_FRAMES,
    smoothing_alpha: float = DEFAULT_SMOOTHING_ALPHA,
    tasks_model_path: Optional[str | Path] = None,
) -> bool:
    """Render a vertical reframed clip using face-tracking crop windows."""

    detect_every_n_frames = max(1, int(detect_every_n_frames))
    smoothing_alpha = float(smoothing_alpha)

    capture = cv2.VideoCapture(str(source_path))
    if not capture.isOpened():
        logger.error("Unable to open source video for smart framing: %s", source_path)
        return False

    fps = float(capture.get(cv2.CAP_PROP_FPS))
    if fps <= 0.0 or not math.isfinite(fps):
        fps = 30.0

    source_width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    source_height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    capture.release()

    if source_width <= 0 or source_height <= 0:
        logger.error("Could not read source dimensions for smart framing: %s", source_path)
        return False

    start_frame = max(0, int(round(start_seconds * fps)))
    requested_frames = max(1, int(round(duration_seconds * fps)))

    crop_windows, processed_frames = smart_reframe_segment(
        source_path=source_path,
        start_frame=start_frame,
        requested_frames=requested_frames,
        frame_w=source_width,
        frame_h=source_height,
        width=target_width,
        height=target_height,
        detect_every_n_frames=detect_every_n_frames,
        smoothing_alpha=smoothing_alpha,
        tasks_model_path=tasks_model_path,
    )
    if processed_frames <= 0 or not crop_windows:
        logger.error("Smart framing read zero frames for %s", source_path)
        return False

    capture = cv2.VideoCapture(str(source_path))
    if not capture.isOpened():
        logger.error("Unable to reopen source video for smart framing: %s", source_path)
        return False
    capture.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

    output_video_path.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(
        str(output_video_path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (target_width, target_height),
    )
    if not writer.isOpened():
        capture.release()
        logger.error("Unable to open VideoWriter for %s", output_video_path)
        return False

    written_frames = 0
    for frame_index in range(processed_frames):
        ok, frame = capture.read()
        if not ok:
            break
        left, top, window_width, window_height = crop_windows[frame_index]
        crop = frame[top : top + window_height, left : left + window_width]
        if crop.size == 0:
            crop = frame
        reframed = cv2.resize(
            crop,
            (target_width, target_height),
            interpolation=cv2.INTER_LINEAR,
        )
        writer.write(reframed)
        written_frames += 1

    capture.release()
    writer.release()

    if written_frames <= 0:
        logger.error("Smart framing wrote zero frames to %s", output_video_path)
        return False

    return True
