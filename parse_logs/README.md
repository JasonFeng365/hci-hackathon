# Log Analysis Scripts

Parse whale-tutoring study logs and generate analysis figures.

## Setup

```sh
pip install -r requirements.txt   # matplotlib, numpy, pandas
```

## Usage

From the project root:

```sh
python parse_logs/analyze_logs.py
```

This reads all JSON files from `logs/`, prints a summary table to stdout, and saves figures to `parse_logs/figures/`.

Custom paths are supported via flags:

```sh
python parse_logs/analyze_logs.py --logs-dir /path/to/logs --output-dir /path/to/output
```

### Empty sessions

By default, training-phase logs with no user messages (blank starts) are excluded from analysis. Include them with:

```sh
python parse_logs/analyze_logs.py --include-empty-sessions
```

## Generated Figures

| File | Description |
|------|-------------|
| `stage_distribution.png` | Participant stage breakdown (training → done) |
| `sentiment_by_condition_overall.png` | Overall sentiment scores by evaluation condition (tutor vs popup) |
| `sentiment_by_condition_items.png` | Per-item sentiment breakdown across all 5 constructs |
| `questions_vs_sentiment.png` | Correlation between user questions asked and average rating |
| `quiz_performance.png` | Quiz correctness by evaluation condition |
| `questions_distribution.png` | Histogram of user question counts in training phase |
| `construct_correlation.png` | Pearson correlation heatmap between sentiment constructs |
