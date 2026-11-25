"""Report and deck charts, read directly from the frozen evaluation report (no hand-typed numbers).

Usage (from the repo root, in any env with matplotlib):
    python docs/report/tools/charts.py backend/artifacts/eval_report.json docs/report/figures
"""
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

GRAPHITE, SILVER, ELECTRIC, INK3 = "#101828", "#C0C7D1", "#005BFF", "#4A5466"
plt.rcParams.update({
    "font.family": ["Helvetica Neue", "Helvetica", "Arial", "DejaVu Sans"],
    "font.size": 11, "axes.edgecolor": "#D0D5DD", "axes.labelcolor": INK3, "xtick.color": INK3, "ytick.color": INK3,
    "axes.spines.top": False, "axes.spines.right": False, "figure.dpi": 200, "savefig.bbox": "tight",
    "savefig.facecolor": "white",
})


def load(path):
    r = json.loads(Path(path).read_text())
    a = {x["name"]: x for x in r["approaches"]}
    return r, a


def bars(ax, labels, series, colors, names, fmt="{:.1%}", ymax=1.0, legend_out=False):
    n = len(series)
    w = 0.8 / n
    for i, (vals, c, name) in enumerate(zip(series, colors, names)):
        xs = [k + (i - (n - 1) / 2) * w for k in range(len(labels))]
        b = ax.bar(xs, vals, w * 0.92, color=c, label=name, zorder=3)
        for x, v in zip(xs, vals):
            ax.text(x, v + ymax * 0.015, fmt.format(v), ha="center", va="bottom", fontsize=9, color=GRAPHITE)
    ax.set_xticks(range(len(labels)), labels)
    ax.set_ylim(0, ymax)
    ax.yaxis.grid(True, color="#EEF0F3", zorder=0)
    if legend_out:
        ax.legend(frameon=False, fontsize=9, loc="upper center", bbox_to_anchor=(0.5, -0.24), ncol=2)
    else:
        ax.legend(frameon=False, loc="upper right", fontsize=9)


def main(report, out):
    out = Path(out); out.mkdir(parents=True, exist_ok=True)
    r, a = load(report)
    st, ss = a["static_rules"], a["securesynth"]

    # 1. Detection quality (intervention = STEP_UP or BLOCK)
    fig, ax = plt.subplots(figsize=(7.2, 3.6))
    keys = [("recall", "Recall"), ("precision", "Precision"), ("f1", "F1"), ("fpr", "Genuine sessions\ninterrupted")]
    bars(ax, [k[1] for k in keys], [[st["intervention"][k] for k, _ in keys], [ss["intervention"][k] for k, _ in keys]],
         [SILVER, ELECTRIC], ["Static global rules", "SecureSynth"])
    ax.set_title("Detection on the fresh synthetic test population (4,665 sessions, 367 takeovers)", fontsize=10.5, color=GRAPHITE, loc="left")
    fig.savefig(out / "fig-detection.png"); plt.close(fig)

    # 2. Customer friction
    fig, ax = plt.subplots(figsize=(7.2, 3.4))
    labs = ["All genuine\nsessions", "Travellers", "New-device\nsessions", "Genuine sessions\nblocked outright"]
    keyf = lambda x: [x["intervention"]["fpr"], x["traveller_restriction_rate"], x["new_device_restriction_rate"], x["legit_block_rate"]]
    bars(ax, labs, [keyf(st), keyf(ss)], [SILVER, ELECTRIC], ["Static global rules", "SecureSynth"], ymax=1.12)
    ax.set_title("Genuine customers interrupted (lower is better)", fontsize=10.5, color=GRAPHITE, loc="left")
    fig.savefig(out / "fig-friction.png"); plt.close(fig)

    # 3. Recall by attack family
    fams = [("A", "A\nSIM swap"), ("B", "B\nOTP relay"), ("C", "C\nfamiliar-device\nhijack"), ("E", "E\nremote access"), ("D", "D\nlow-and-slow\n(held out)")]
    fig, ax = plt.subplots(figsize=(7.2, 3.8))
    bars(ax, [f[1] for f in fams], [[st["per_family_recall"][k] for k, _ in fams], [ss["per_family_recall"][k] for k, _ in fams]],
         [SILVER, ELECTRIC], ["Static global rules", "SecureSynth"], fmt="{:.0%}", ymax=1.12, legend_out=True)
    ax.set_title("Recall by attack family", fontsize=10.5, color=GRAPHITE, loc="left")
    fig.savefig(out / "fig-families.png"); plt.close(fig)

    # 4. Money: attack value stopped (block vs challenge) and genuine value delayed, in ₹ crore
    cr = lambda p: p / 100 / 1e7
    fig, ax = plt.subplots(figsize=(7.2, 3.4))
    names = ["Static global rules", "SecureSynth"]
    blk = [cr(st["prevention"]["attack_value_prevented_by_block_paise"]), cr(ss["prevention"]["attack_value_prevented_by_block_paise"])]
    chl = [cr(st["prevention"]["attack_value_prevented_by_challenge_paise"]), cr(ss["prevention"]["attack_value_prevented_by_challenge_paise"])]
    dly = [cr(st["prevention"]["legit_value_delayed_paise"]), cr(ss["prevention"]["legit_value_delayed_paise"])]
    y = [1, 0]
    ax.barh([v + 0.18 for v in y], blk, 0.34, color=GRAPHITE, label="Attack value stopped by BLOCK", zorder=3)
    ax.barh([v + 0.18 for v in y], chl, 0.34, left=blk, color=SILVER, label="…stopped by step-up (assumes attacker fails it)", zorder=3)
    ax.barh([v - 0.18 for v in y], dly, 0.34, color="#B54708", alpha=0.85, label="Genuine value delayed", zorder=3)
    for yy, b, c, d in zip(y, blk, chl, dly):
        ax.text(b + c + 0.04, yy + 0.18, f"₹{b + c:.2f} cr", va="center", fontsize=9, color=GRAPHITE)
        ax.text(d + 0.04, yy - 0.18, f"₹{d:.2f} cr", va="center", fontsize=9, color=GRAPHITE)
    ax.set_yticks(y, names)
    ax.set_xlabel("₹ crore (synthetic)")
    att = cr(ss["prevention"]["attack_value_attempted_paise"])
    ax.set_title(f"Money: ₹{att:.2f} cr of attack transfers attempted", fontsize=10.5, color=GRAPHITE, loc="left")
    ax.xaxis.grid(True, color="#EEF0F3", zorder=0)
    ax.legend(frameon=False, fontsize=8.5, loc="upper center", bbox_to_anchor=(0.5, -0.2), ncol=2)
    ax.set_xlim(0, 3.6)
    fig.savefig(out / "fig-money.png"); plt.close(fig)
    print("charts written to", out)


if __name__ == "__main__":
    main(*sys.argv[1:3])
