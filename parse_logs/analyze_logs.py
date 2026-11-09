"""
Parse whale-tutoring study logs and generate analysis graphs.

Reads all JSON files from the logs/ directory (relative to project root),
extracts participant stage, evaluation ratings, quiz results, and chat interaction data,
then produces publication-ready figures saved as PNG files.

Usage:
    python analyze_logs.py [--logs-dir PATH] [--output-dir PATH]
"""

import argparse
import json
import os
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")  # non-interactive backend for headless / CI use
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def _is_empty_session(record: dict) -> bool:
    """Return True if the session is in training with no user messages (blank start)."""
    mode = record.get("mode", "")
    if mode != "training":
        return False
    msg_roles = [m.get("role") for m in record.get("messages", [])]
    # Only system + initial assistant welcome → no user interaction yet
    return msg_roles == ["system", "assistant"]


def load_all_logs(logs_dir: str, include_empty: bool = False) -> list[dict]:
    """Load every JSON log file and return a list of parsed dicts.

    By default, sessions that are still in *training* with no user messages
    (i.e. blank/empty starts) are excluded.  Pass ``include_empty=True`` to keep them.
    """
    logs_path = Path(logs_dir)
    if not logs_path.is_dir():
        print(f"[ERROR] Logs directory not found: {logs_dir}", file=sys.stderr)
        sys.exit(1)

    records = []
    skipped_empty = 0
    for fp in sorted(logs_path.glob("*.json")):
        try:
            with open(fp, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (json.JSONDecodeError, OSError) as exc:
            print(f"[WARN] Skipping {fp.name}: {exc}", file=sys.stderr)
            continue

        if not include_empty and _is_empty_session(data):
            skipped_empty += 1
            continue

        data["_filename"] = fp.stem
        records.append(data)

    return records, skipped_empty


# ---------------------------------------------------------------------------
# Feature extraction helpers
# ---------------------------------------------------------------------------

def extract_user_question_count(record: dict) -> int:
    """Count how many user messages were sent during the training phase."""
    count = 0
    for msg in record.get("messages", []):
        if msg.get("role") == "user":
            count += 1
    return count


def extract_assistant_response_count(record: dict) -> int:
    """Count assistant replies (excluding the initial welcome message)."""
    # The first assistant message is the welcome/facts dump.
    # Every subsequent assistant message is a clarification reply.
    replies = [m for m in record.get("messages", []) if m.get("role") == "assistant"]
    return max(0, len(replies) - 1)


def extract_quiz_correct(record: dict) -> int | None:
    """Return number of correct quiz answers (or None if not completed)."""
    results = record.get("quiz_results")
    if isinstance(results, list):
        return sum(1 for r in results if r is True)
    return None


def extract_ratings(record: dict) -> pd.DataFrame | None:
    """Return a long-form DataFrame of evaluation ratings or None."""
    ratings = record.get("evaluation_ratings")
    if not isinstance(ratings, list) or len(ratings) == 0:
        return None

    rows = []
    for r in ratings:
        rows.append({
            "item_id": r.get("item_id", ""),
            "construct": r.get("construct", ""),
            "statement": r.get("statement", ""),
            "score": int(r.get("score", 0)),
        })
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Graph functions — each returns a matplotlib Figure
# ---------------------------------------------------------------------------

def plot_stage_distribution(records: list[dict], output_dir: Path) -> None:
    """Bar chart of participant stage distribution."""
    mode_counts = {}
    for r in records:
        mode = r.get("mode", "unknown")
        mode_counts[mode] = mode_counts.get(mode, 0) + 1

    # Order stages logically
    order = ["training", "testing", "evaluating", "done"]
    labels = [f"{s}\n(n={mode_counts.get(s, 0)})" for s in order]
    values = [mode_counts.get(s, 0) for s in order]

    fig, ax = plt.subplots(figsize=(7, 5))
    colors = ["#4C72B0", "#DD8452", "#55A868", "#C44E52"]
    bars = ax.bar(labels, values, color=colors[:len(values)], edgecolor="white")

    for bar, val in zip(bars, values):
        if val > 0:
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.15,
                    str(val), ha="center", va="bottom", fontweight="bold")

    ax.set_ylabel("Number of Participants")
    ax.set_title("Participant Stage Distribution")
    ax.set_ylim(0, max(values) * 1.2 if values else 1)
    fig.tight_layout()
    out = output_dir / "stage_distribution.png"
    fig.savefig(out, dpi=150)
    plt.close(fig)
    print(f"[OK] Saved {out}")


def plot_sentiment_by_condition(records: list[dict], output_dir: Path) -> None:
    """Box-and-whisker + swarm plot of sentiment scores grouped by condition."""
    # Build long-form data
    rows = []
    for r in records:
        ratings_df = extract_ratings(r)
        if ratings_df is None:
            continue
        cond = r.get("evaluation_condition", "unknown")
        for _, row in ratings_df.iterrows():
            rows.append({
                "condition": cond,
                "item_id": row["item_id"],
                "construct": row["construct"],
                "score": row["score"],
            })

    if not rows:
        print("[WARN] No evaluation ratings found — skipping sentiment plots.")
        return

    df = pd.DataFrame(rows)

    # --- Overall scores by condition (all items pooled) ---
    fig, ax = plt.subplots(figsize=(7, 5))
    conditions = sorted(df["condition"].unique())
    x_pos = np.arange(len(conditions))
    box_data = [df.loc[df["condition"] == c, "score"].values for c in conditions]

    bp = ax.boxplot(box_data, tick_labels=[f"{c}\n(n={len(df[df['condition']==c])})" for c in conditions],
                    patch_artist=True, widths=0.5)
    for patch, color in zip(bp["boxes"], ["#4C72B0", "#DD8452"]):
        patch.set_facecolor(color)

    # jittered swarm overlay
    for i, c in enumerate(conditions):
        scores = df.loc[df["condition"] == c, "score"].values
        jitter = np.random.normal(0, 0.06, size=len(scores))
        ax.scatter(x_pos[i] + jitter, scores, alpha=0.5, s=25, color="black", zorder=3)

    ax.set_ylabel("Rating Score (1–10)")
    ax.set_title("Overall Sentiment by Evaluation Condition")
    ax.set_ylim(0, 11)
    fig.tight_layout()
    out = output_dir / "sentiment_by_condition_overall.png"
    fig.savefig(out, dpi=150)
    plt.close(fig)
    print(f"[OK] Saved {out}")

    # --- Per-item scores by condition (side-by-side boxplots) ---
    item_ids = sorted(df["item_id"].unique())
    n_items = len(item_ids)
    fig, axes = plt.subplots(1, n_items, figsize=(5 * n_items, 4.5), sharey=True)
    if n_items == 1:
        axes = [axes]

    for ax, item in zip(axes, item_ids):
        sub = df[df["item_id"] == item]
        box_data = [sub.loc[sub["condition"] == c, "score"].values for c in conditions]
        bp = ax.boxplot(box_data, tick_labels=[f"{c}\n(n={len(sub[sub['condition']==c])})" for c in conditions],
                        patch_artist=True, widths=0.5)
        for patch, color in zip(bp["boxes"], ["#4C72B0", "#DD8452"]):
            patch.set_facecolor(color)

        # swarm overlay per condition
        for i, c in enumerate(conditions):
            scores = sub.loc[sub["condition"] == c, "score"].values
            jitter = np.random.normal(0, 0.06, size=len(scores))
            ax.scatter(i + 1 + jitter, scores, alpha=0.5, s=25, color="black", zorder=3)

        ax.set_title(item.replace("_", " ").title())
        ax.set_ylim(0, 11)
        ax.set_ylabel("")

    fig.suptitle("Sentiment Scores by Item and Evaluation Condition")
    fig.tight_layout()
    out = output_dir / "sentiment_by_condition_items.png"
    fig.savefig(out, dpi=150)
    plt.close(fig)
    print(f"[OK] Saved {out}")


def plot_questions_vs_sentiment(records: list[dict], output_dir: Path) -> None:
    """Scatter of user questions vs average rating score, colored by condition."""
    points = []
    for r in records:
        ratings_df = extract_ratings(r)
        if ratings_df is None:
            continue
        n_questions = extract_user_question_count(r) - 1  # subtract initial welcome acknowledgment (if any)
        avg_score = float(ratings_df["score"].mean())
        cond = r.get("evaluation_condition", "unknown")
        points.append({
            "questions": max(0, n_questions),
            "avg_score": avg_score,
            "condition": cond,
            "participant_index": r.get("participant_index"),
        })

    if not points:
        print("[WARN] No completed evaluations — skipping questions-vs-sentiment plot.")
        return

    df = pd.DataFrame(points)

    fig, ax = plt.subplots(figsize=(7, 5))
    for cond in sorted(df["condition"].unique()):
        sub = df[df["condition"] == cond]
        color = "#4C72B0" if cond == "tutor" else "#DD8452"
        ax.scatter(sub["questions"], sub["avg_score"], label=cond, c=color, s=60, alpha=0.7, edgecolors="black", linewidths=0.5)

    # trend line (OLS) for each condition
    for cond in sorted(df["condition"].unique()):
        sub = df[df["condition"] == cond]
        if len(sub) >= 2:
            z = np.polyfit(sub["questions"], sub["avg_score"], 1)
            p = np.poly1d(z)
            x_line = np.linspace(sub["questions"].min(), sub["questions"].max(), 50)
            ax.plot(x_line, p(x_line), "--", color="gray", alpha=0.6)

    ax.set_xlabel("Number of User Questions in Training Phase")
    ax.set_ylabel("Average Sentiment Score (1–10)")
    ax.set_title("User Questions vs Average Sentiment Rating\n(colored by evaluation condition)")
    ax.legend(title="Condition")
    fig.tight_layout()
    out = output_dir / "questions_vs_sentiment.png"
    fig.savefig(out, dpi=150)
    plt.close(fig)
    print(f"[OK] Saved {out}")


def plot_quiz_performance(records: list[dict], output_dir: Path) -> None:
    """Boxplot of quiz correctness by evaluation condition."""
    rows = []
    for r in records:
        correct = extract_quiz_correct(r)
        if correct is None:
            continue
        cond = r.get("evaluation_condition", "unknown")
        rows.append({"condition": cond, "correct": correct})

    if not rows:
        print("[WARN] No quiz results found — skipping quiz performance plot.")
        return

    df = pd.DataFrame(rows)
    fig, ax = plt.subplots(figsize=(7, 4))
    conditions = sorted(df["condition"].unique())
    x_pos = np.arange(len(conditions))
    box_data = [df.loc[df["condition"] == c, "correct"].values for c in conditions]

    bp = ax.boxplot(box_data, tick_labels=[f"{c}\n(n={len(df[df['condition']==c])})" for c in conditions],
                    patch_artist=True, widths=0.5)
    for patch, color in zip(bp["boxes"], ["#4C72B0", "#DD8452"]):
        patch.set_facecolor(color)

    ax.set_ylabel("Correct Answers (out of 5)")
    ax.set_title("Quiz Performance by Evaluation Condition")
    ax.set_ylim(0, 5.5)
    fig.tight_layout()
    out = output_dir / "quiz_performance.png"
    fig.savefig(out, dpi=150)
    plt.close(fig)
    print(f"[OK] Saved {out}")


def plot_questions_distribution(records: list[dict], output_dir: Path) -> None:
    """Histogram of user question counts across all participants."""
    counts = []
    for r in records:
        n = extract_user_question_count(r) - 1  # subtract initial assistant welcome
        counts.append(max(0, n))

    if not counts:
        print("[WARN] No chat messages found — skipping question distribution plot.")
        return

    fig, ax = plt.subplots(figsize=(7, 5))
    unique_counts = sorted(set(counts))
    hist_vals = [counts.count(c) for c in unique_counts]

    bars = ax.bar(unique_counts, hist_vals, color="#4C72B0", edgecolor="white")
    for bar, val in zip(bars, hist_vals):
        if val > 0:
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.15,
                    str(val), ha="center", va="bottom", fontweight="bold")

    ax.set_xlabel("Number of User Questions Asked")
    ax.set_ylabel("Number of Participants")
    ax.set_title("Distribution of User Questions in Training Phase")
    fig.tight_layout()
    out = output_dir / "questions_distribution.png"
    fig.savefig(out, dpi=150)
    plt.close(fig)
    print(f"[OK] Saved {out}")


def plot_construct_correlation(records: list[dict], output_dir: Path) -> None:
    """Correlation heatmap of the five sentiment constructs."""
    rows = []
    for r in records:
        ratings_df = extract_ratings(r)
        if ratings_df is None:
            continue
        cond = r.get("evaluation_condition", "unknown")
        for _, row in ratings_df.iterrows():
            rows.append({
                "item_id": row["item_id"],
                "construct": row["construct"],
                "score": row["score"],
                "condition": cond,
            })

    if not rows:
        print("[WARN] No evaluation data for correlation heatmap.")
        return

    df = pd.DataFrame(rows)

    # Build per-participant wide matrix for correlation
    items = sorted(df["item_id"].unique())
    corr_matrix = np.zeros((len(items), len(items)))
    for i, item_i in enumerate(items):
        for j, item_j in enumerate(items):
            si = df[df["item_id"] == item_i]["score"]
            sj = df[df["item_id"] == item_j]["score"]
            if len(si) > 1 and len(sj) > 1:
                corr_matrix[i, j] = np.corrcoef(si.values, sj.values)[0, 1]

    fig, ax = plt.subplots(figsize=(6, 5))
    im = ax.imshow(corr_matrix, cmap="RdBu_r", vmin=-1, vmax=1, aspect="auto")

    item_labels = [id_.replace("_", " ").title() for id_ in items]
    ax.set_xticks(range(len(items)))
    ax.set_yticks(range(len(items)))
    ax.set_xticklabels(item_labels, rotation=45, ha="right", fontsize=9)
    ax.set_yticklabels(item_labels, fontsize=9)

    for i in range(len(items)):
        for j in range(len(items)):
            val = corr_matrix[i, j]
            if not np.isnan(val):
                text = ax.text(j, i, f"{val:.2f}", ha="center", va="center", fontsize=8)

    fig.colorbar(im, label="Pearson r")
    ax.set_title("Correlation Between Sentiment Constructs\n(all participants)")
    fig.tight_layout()
    out = output_dir / "construct_correlation.png"
    fig.savefig(out, dpi=150)
    plt.close(fig)
    print(f"[OK] Saved {out}")


def plot_questions_per_participant(records: list[dict], output_dir: Path) -> None:
    """Grouped bar chart of per-participant question counts, split by evaluation condition.

    Only includes participants who completed the study (mode == 'done').
    """
    points = []
    for r in records:
        if r.get("mode") != "done":
            continue
        n_questions = extract_user_question_count(r)
        cond = r.get("evaluation_condition", "unknown")
        idx = r.get("participant_index", "?")
        points.append({"index": idx, "questions": max(0, n_questions), "condition": cond})

    if not points:
        print("[WARN] No completed evaluations — skipping per-participant questions plot.")
        return

    df = pd.DataFrame(points)
    conditions = sorted(df["condition"].unique())

    fig, ax = plt.subplots(figsize=(7, 5))
    bar_width = 0.35
    x_base = np.arange(len(conditions))

    for i, cond in enumerate(conditions):
        sub = df[df["condition"] == cond]
        # Sort by question count for readability
        sorted_vals = sorted(sub["questions"].tolist())
        color = "#4C72B0" if cond == "tutor" else "#DD8452"
        ax.bar(
            x_base[i] + np.arange(len(sorted_vals)) * bar_width,
            sorted_vals,
            width=bar_width,
            label=f"{cond} (n={len(sub)})",
            color=color,
            edgecolor="white",
        )

    # Annotate each bar with its value
    for i, cond in enumerate(conditions):
        sub = df[df["condition"] == cond].sort_values("questions")
        vals = sub["questions"].tolist()
        for j, v in enumerate(vals):
            ax.text(
                x_base[i] + j * bar_width + bar_width / 2,
                v + 0.15,
                str(v),
                ha="center", va="bottom", fontsize=9, fontweight="bold",
            )

    # Set x-ticks at the center of each group
    tick_positions = [x_base[i] + bar_width / 2 for i in range(len(conditions))]
    ax.set_xticks(tick_positions)
    ax.set_xticklabels([f"{c}\n(n={len(df[df['condition']==c])})" for c in conditions])

    ax.set_ylabel("Number of User Messages in Training Phase")
    ax.set_title("Per-Participant Question Count by Evaluation Condition\n(completed participants only)")
    ax.set_ylim(0, max(df["questions"].max() * 1.3, 2))
    fig.tight_layout()
    out = output_dir / "questions_per_participant.png"
    fig.savefig(out, dpi=150)
    plt.close(fig)
    print(f"[OK] Saved {out}")


# ---------------------------------------------------------------------------
# Summary statistics (printed to stdout)
# ---------------------------------------------------------------------------

def print_summary(records: list[dict]) -> None:
    """Print a human-readable summary table to stdout."""
    total = len(records)
    if total == 0:
        print("No log files found.")
        return

    modes = {}
    conditions = {"tutor": 0, "popup": 0}
    completed = 0
    quiz_scores = []
    question_counts = []

    for r in records:
        mode = r.get("mode", "unknown")
        modes[mode] = modes.get(mode, 0) + 1
        cond = r.get("evaluation_condition", "")
        if cond == "tutor":
            conditions["tutor"] += 1
        elif cond == "popup":
            conditions["popup"] += 1

        if mode == "done":
            completed += 1
            ratings_df = extract_ratings(r)
            if ratings_df is not None:
                question_counts.append(extract_user_question_count(r))
            quiz_correct = extract_quiz_correct(r)
            if quiz_correct is not None:
                quiz_scores.append(quiz_correct)

    print("=" * 60)
    print("  WHALE-TUTORING STUDY — LOG SUMMARY")
    print("=" * 60)
    print(f"\nTotal participants (log files): {total}")
    print(f"  Tutor condition:              {conditions['tutor']}")
    print(f"  Popup condition:              {conditions['popup']}")

    print("\nStage distribution:")
    for stage in ["training", "testing", "evaluating", "done"]:
        count = modes.get(stage, 0)
        pct = count / total * 100 if total else 0
        print(f"  {stage:15s}: {count:3d} ({pct:.0f}%)")

    print(f"\nCompleted evaluations (done):   {completed}")

    if quiz_scores:
        qs = np.array(quiz_scores)
        print(f"\nQuiz correctness (n={len(qs)}):")
        print(f"  Mean correct:                 {qs.mean():.2f} / 5")
        print(f"  Std dev:                      {qs.std():.2f}")

    if question_counts:
        qc = np.array(question_counts)
        print(f"\nUser questions in training (n={len(qc)}):")
        print(f"  Mean questions asked:         {qc.mean():.1f}")
        print(f"  Std dev:                      {qc.std():.1f}")
        print(f"  Min / Max:                    {qc.min()} / {qc.max()}")

    # Sentiment summary by condition
    tutor_scores = []
    popup_scores = []
    for r in records:
        ratings_df = extract_ratings(r)
        if ratings_df is None:
            continue
        scores = ratings_df["score"].values
        cond = r.get("evaluation_condition", "")
        if cond == "tutor":
            tutor_scores.extend(scores.tolist())
        elif cond == "popup":
            popup_scores.extend(scores.tolist())

    print(f"\nSentiment scores (all items pooled):")
    if tutor_scores:
        ts = np.array(tutor_scores)
        print(f"  Tutor condition:              mean={ts.mean():.2f}, std={ts.std():.2f} (n={len(ts)} ratings)")
    if popup_scores:
        ps = np.array(popup_scores)
        print(f"  Popup condition:              mean={ps.mean():.2f}, std={ps.std():.2f} (n={len(ps)} ratings)")

    print("\n" + "=" * 60)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Parse whale-tutoring study logs and generate graphs.")
    parser.add_argument("--logs-dir", default=None, help="Path to the logs directory (default: ../logs)")
    parser.add_argument("--output-dir", default=None, help="Directory to save output figures (default: ./figures)")
    parser.add_argument("--include-empty-sessions", action="store_true",
                        help="Include training-phase sessions with no user messages (blank starts).")
    args = parser.parse_args()

    # Resolve paths relative to this script's parent (parse_logs/)
    script_dir = Path(__file__).resolve().parent
    if args.logs_dir:
        logs_dir = Path(args.logs_dir)
    else:
        logs_dir = script_dir.parent / "logs"

    output_dir = Path(args.output_dir) if args.output_dir else script_dir / "figures"
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading logs from: {logs_dir}")
    records, skipped_empty = load_all_logs(str(logs_dir), include_empty=args.include_empty_sessions)
    if skipped_empty:
        print(f"Filtered out {skipped_empty} empty session(s) (training with no user messages). "
              f"Use --include-empty-sessions to keep them.\n")
    else:
        print("")
    print(f"Loaded {len(records)} participant log(s).\n")

    # Print summary to stdout
    print_summary(records)

    # Generate all graphs
    print("\nGenerating figures...")
    plot_stage_distribution(records, output_dir)
    plot_sentiment_by_condition(records, output_dir)
    plot_questions_vs_sentiment(records, output_dir)
    plot_quiz_performance(records, output_dir)
    plot_questions_distribution(records, output_dir)
    plot_construct_correlation(records, output_dir)
    plot_questions_per_participant(records, output_dir)

    print(f"\nAll figures saved to: {output_dir}")


if __name__ == "__main__":
    main()
