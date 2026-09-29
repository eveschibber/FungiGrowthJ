# FungiGrowthJ Biological Analysis Notebook
## User and methodological documentation

**Notebook:** `FungiGrowthJ_Biological_Report_GENERIC_v4_SATELLITES_STYLED_EXECUTED.ipynb`  
**Purpose:** generic biological analysis of FungiGrowthJ result archives  
**Input:** a ZIP archive containing `*_FungiGrowthJ_results.csv` files  
**Output:** tables, figures, and a standalone HTML biological-analysis report

---

## 1. What this notebook does

This notebook separates **measurement** from **biological analysis**.

FungiGrowthJ produces image-level measurements and review/classification information. The notebook then:

1. loads all result CSV files from a ZIP archive;
2. normalizes metadata and resolves multiple revisions of the same image;
3. identifies the main/central colony explicitly from the FungiGrowthJ classification;
4. builds date-level observations for each biological replicate;
5. calculates replicate-level growth parameters and endpoints;
6. separately summarizes the central colony, satellite colonies, and the combined global phenotype;
7. produces growth trajectories and morphology plots;
8. performs strain-level omnibus and exploratory pairwise comparisons;
9. builds a multivariate strain phenotype profile for PCA and hierarchical clustering;
10. generates a standalone HTML report and machine-readable tables.

The notebook is deliberately **generic**. It does not assume a particular set of strain names, exactly three replicates, R1/R2/R3, a fixed number of dates, or a specific FungiGrowthJ software version. Measurements that are not present in the input are skipped rather than invented.

---

# 2. How to use the notebook

### Requirements

The notebook uses:

- Python 3
- NumPy
- pandas
- Matplotlib
- SciPy
- scikit-learn
- Jupyter Notebook / JupyterLab

### Input structure

Provide a ZIP archive containing FungiGrowthJ result CSV files. The notebook searches for files whose names contain:

```text
_FungiGrowthJ_results.csv
```

### Minimal workflow

1. Open the notebook.
2. In the **USER CONFIGURATION** cell, set:

```python
ZIP_PATH = Path("results.zip")
```

3. Run **Run All**.

The notebook creates:

```text
FGJ_biological_report/
├── figures/
└── tables/
```

and also creates a standalone:

```text
FungiGrowthJ_Biological_Report.html
```

inside the output directory.

---

# 3. User configuration

The configuration cell contains the main analysis choices.

### `ZIP_PATH`

Path to the input results archive.

### `MAIN_COLONY_LABELS`

```python
MAIN_COLONY_LABELS = {
    "CEN", "CENTRAL", "MAIN", "PRIMARY",
    "MAIN_COLONY", "CENTRAL_COLONY"
}
```

The notebook searches `final_type` first and `proposed_type` second.

The actual FungiGrowthJ dataset used for development contains the label **`CEN`**, so `CEN` is recognized as the main colony label.

The notebook does **not** infer the main colony from size, position, proximity to the plate center, or any other morphological property.

### `MULTIPLE_MAIN_POLICY`

Default:

```python
MULTIPLE_MAIN_POLICY = "exclude"
```

When an image contains more than one object explicitly classified as the main colony, the default is to exclude that image from the date-level biological summary rather than silently choosing one.

An alternative available in the code is:

```python
MULTIPLE_MAIN_POLICY = "largest"
```

which selects the largest main-labelled object.

The rigorous default is therefore **exclude ambiguous images**.

### `ALPHA`

```python
ALPHA = 0.05
```

Nominal threshold used when the notebook summarizes omnibus statistical results.

### `MIN_POINTS_FOR_RATE`

```python
MIN_POINTS_FOR_RATE = 3
```

A replicate needs at least three valid temporal observations to receive a growth-rate estimate.

---

# 4. Data flow through the notebook

The central data objects are:

```text
raw
  ↓
selected
  ↓
candidate / bio
  ↓
replicate_summary
  ↓
composition
  ↓
satellite_summary / global_replicate_summary
  ↓
figures + statistical analyses + HTML report
```

The most important distinction is between:

- **date-level observations** used for trajectories and descriptive longitudinal plots;
- **replicate-level summaries** used as the experimental unit for strain-level inference;
- **strain-level profiles** used for PCA and clustering.

---

# 5. Notebook blocks

## Block 1 — User configuration

**Purpose:** define input path, main-colony labels, statistical alpha, and minimum observations required for rate estimation.

**Why:** these are the few choices that control the analysis without changing the scientific calculations elsewhere in the notebook.

---

## Block 2 — Imports and helper functions

Imports:

- NumPy
- pandas
- Matplotlib
- SciPy statistics
- SciPy hierarchical clustering
- scikit-learn StandardScaler
- scikit-learn PCA

Helper functions include:

- `first_existing()` — finds the first available metadata column;
- `slug()` — generates safe filenames.

**Why:** the notebook is designed to tolerate small differences among FungiGrowthJ result schemas.

---

## Block 3 — Load raw FungiGrowthJ results

The notebook:

- opens the ZIP;
- finds all `*_FungiGrowthJ_results.csv`;
- reads each CSV;
- concatenates them into `raw`.

Important fields remain attached to every row, including:

- strain;
- replicate;
- date;
- image filename;
- classification;
- measurements;
- software/version metadata when available;
- analysis revision when available.

**Output:** `raw`

**Why:** all original result rows are retained before biological filtering or aggregation.

---

## Block 4 — Normalize metadata and resolve revisions

The notebook identifies the available columns for:

- date;
- strain;
- replicate;
- image filename.

It constructs:

```text
_image_key =
strain + replicate + date + image_file
```

It then computes a revision rank using the maximum of:

- the explicit `analysis_revision` field, when available;
- the revision number encoded in the source path, when available.

Only the highest revision for each image identity is retained in:

```text
selected
```

**Why:** biological analysis must not count multiple revisions of the same image as independent observations.

---

# 6. Main-colony identification

## Block 6 — Identify the main colony explicitly

The notebook searches for a recognized main-colony label.

Priority:

1. `final_type`
2. `proposed_type`

Then:

```python
selected["_main_candidate"]
```

is a Boolean indicator of whether the row is the recognized main colony.

The notebook reports how many images have:

- zero main candidates;
- exactly one main candidate;
- more than one main candidate.

**Why:** the central colony is a biological classification from FungiGrowthJ, not something the notebook should infer from size.

---

# 7. Date-level biological observations

## Block 7 — Build `bio`

Only rows classified as the main colony enter this table.

The following measurements are retained when available:

```text
area_mm2
perimeter_mm
equivalent_radius_mm
equivalent_diameter_mm
major_axis_mm
minor_axis_mm
feret_max_mm
feret_min_mm
circularity
aspect_ratio
eccentricity
solidity
convexity
plate_occupancy_pct
```

For each:

```text
strain × replicate × date
```

the notebook uses the **median** of the available image-level values.

It also records:

```text
n_images
```

for that date-level observation.

### Equivalent radius

The notebook uses FungiGrowthJ's:

```text
equivalent_radius_mm
```

when available.

If equivalent radius is missing but area is available, it derives:

\[
r_{eq} = \sqrt{\frac{A}{\pi}}
\]

and records:

```text
radius_source = "derived_from_area"
```

Otherwise:

```text
radius_source = "plugin_measurement"
```

**Why:** equivalent radius provides a size metric that is directly comparable across irregular colony shapes while still being derived from measured colony area.

---

# 8. Time scale

For each biological replicate:

```text
t_days = days since the first observation of that replicate
```

This means longitudinal curves are aligned to the first sampled observation of each replicate rather than to a global calendar date.

**Why:** the notebook compares trajectories on a common elapsed-time scale.

---

# 9. Replicate-level growth parameters

## Block 8 — `replicate_summary`

This is one of the most important tables in the notebook.

For each:

```text
strain × replicate
```

the notebook calculates:

### Colony area

```text
initial_area_mm2
final_area_mm2
max_area_mm2
area_rate_mm2_day
area_rate_r2
```

### Equivalent radius

```text
initial_radius_mm
final_radius_mm
max_radius_mm
radial_rate_mm_day
radial_rate_r2
```

### Morphology

For each available morphology variable:

```text
final_circularity
mean_circularity

final_aspect_ratio
mean_aspect_ratio

final_eccentricity
mean_eccentricity

final_solidity
mean_solidity

final_convexity
mean_convexity
```

and:

```text
final_perimeter_mm
mean_perimeter_mm
```

### How growth rates are calculated

For both area and equivalent radius, the notebook fits:

\[
y = a + bt
\]

using ordinary least-squares linear regression over the available longitudinal observations for that replicate.

The slope:

```text
b
```

is the observed average rate.

Therefore:

```text
area_rate_mm2_day
```

is the slope of area against time, and:

```text
radial_rate_mm_day
```

is the slope of equivalent radius against time.

The notebook also stores:

```text
R²
```

from the same linear regression.

**Important:** these are **descriptive observed slopes**, not estimates from a mechanistic growth model and not instantaneous growth rates.

---

# 10. Central, satellite, and global phenotype

## Block 9 — `composition`

The notebook separates:

### Central colony

```text
central_area_mm2
```

### Satellites

```text
satellite_total_area_mm2
n_satellites_identifiable
mean_identifiable_satellite_area_mm2
```

A satellite is included only when it is explicitly labelled as:

```text
SAT
SATELLITE
SATELLITES
```

### Global colony

```text
global_area_mm2 =
central_area_mm2 + satellite_total_area_mm2
```

### Satellite fraction

```text
satellite_fraction_global =
satellite_total_area_mm2 / global_area_mm2
```

**Why:** this keeps the central colony and satellite architecture analytically distinct while also providing a combined global phenotype.

---

# 11. Satellite replicate summary

For every biological replicate the notebook calculates:

```text
has_identifiable_satellites
days_to_first_identifiable_satellite
max_identifiable_satellite_count
final_identifiable_satellite_count
final_satellite_area_mm2
max_satellite_area_mm2
mean_satellite_area_mm2_when_identifiable
final_satellite_fraction_global
max_satellite_fraction_global
final_central_area_mm2
final_global_area_mm2
```

If at least three temporal observations are available, it also calculates:

```text
satellite_count_rate
satellite_area_rate_mm2_day
count_down_area_up_pattern
```

The latter is true when:

```text
satellite count slope < 0
AND
satellite area slope > 0
```

This is interpreted as **compatible with colony expansion, merging, or loss of separability**, not as demonstrated biological disappearance of satellites.

---

# 12. Figures: exactly what variables are used

## Figure 1 — Strain central-colony growth trajectories

**File:**

```text
growth_area_strain_mean.png
```

### Variable

```text
bio["area_mm2"]
```

### Grouping

```text
strain_id
t_days
```

### Calculation

For each strain and elapsed time:

- mean area;
- standard deviation.

### Interpretation

Shows the descriptive mean ± SD trajectory of **central colony area** among biological replicates.

Repeated time points are visualized longitudinally, but they are not treated as independent replicates in inferential tests.

---

## Figure 2 — Individual replicate radius trajectories

**File:**

```text
growth_radius_replicates.png
```

### Variable

```text
bio["equivalent_radius_mm"]
```

### Grouping

```text
strain_id
replicate_id
t_days
```

### Interpretation

Each line is one biological replicate.

This figure uses **equivalent radius**, not a geometric radius measured from a manually defined center.

Equivalent radius comes from the measured colony area:

\[
r_{eq} = \sqrt{\frac{A}{\pi}}
\]

unless FungiGrowthJ provided an equivalent-radius measurement directly.

---

## Figure 3 — Central, satellite, and global colony area

**File:**

```text
central_satellite_global_area.png
```

### Variables

```text
central_area_mm2
satellite_total_area_mm2
global_area_mm2
```

from:

```text
composition
```

### Grouping

```text
t_days
```

### Display

Mean ± SD across biological replicates.

### Interpretation

Shows how the measured central colony, identifiable satellite area, and combined global colony area change through time.

---

## Figure 4 — Identifiable satellite count through time

**File:**

```text
satellite_count_trajectory.png
```

### Variable

```text
n_satellites_identifiable
```

from:

```text
composition
```

### Display

Mean ± SD through time.

### Important interpretation

This is the number of **individually distinguishable SAT objects**.

A decrease can occur because:

- colonies expand and merge;
- boundaries become impossible to separate;
- the objects cease to be distinguishable.

The notebook therefore does not interpret a decreasing count automatically as biological disappearance.

---

## Figure 5 — Satellite contribution at final observation

**File:**

```text
satellite_fraction_final.png
```

### Variable

```text
final_satellite_fraction_global
```

from:

```text
satellite_summary
```

### Definition

\[
\text{satellite fraction}
=
\frac{\text{satellite area}}
{\text{central area + satellite area}}
\]

### Inclusion rule

A replicate is included if it had **at least one identifiable satellite at any observation**.

The plotted value is the fraction at that replicate's **final observation**.

### Display

The current version uses:

- one boxplot per strain;
- one point per biological replicate;
- jitter to avoid overlapping points;
- `n` = number of satellite-positive biological replicates.

Therefore, a final value close to 0 does **not** mean the replicate was never satellite-positive.

---

# 13. Morphology figures

## Block 12

Morphology variables:

```text
circularity
aspect_ratio
eccentricity
solidity
convexity
```

These are taken from the date-level `bio` table.

Each morphology figure is a boxplot by strain.

### Important distinction from growth-rate statistics

The morphology plots use the available **date-level observations**, so repeated measurements through time can contribute multiple points.

They are primarily **descriptive phenotype distributions**.

They are not the replicate-level strain tests used in the omnibus statistics.

---

# 14. Statistical analyses

## Block 13 — Omnibus strain comparisons

The experimental unit is:

> **biological replicate**

The tested endpoints are exactly:

```text
final_area_mm2
max_area_mm2
area_rate_mm2_day
final_radius_mm
max_radius_mm
radial_rate_mm_day
```

### ANOVA

For each endpoint:

```text
one-way ANOVA
```

is calculated across strains.

The notebook reports:

```text
anova_F
anova_p
eta_squared
```

### Kruskal–Wallis

For the same endpoint:

```text
Kruskal–Wallis
```

is also calculated.

The notebook reports:

```text
kruskal_H
kruskal_p
```

### Why two omnibus tests?

ANOVA and Kruskal–Wallis provide complementary summaries under different distributional assumptions.

The notebook does not use the time points as independent replicates.

---

# 15. Pairwise comparisons

## Block 14

Pairwise comparisons are performed for the same six endpoints.

For each pair of strains:

```text
Welch's two-sample t-test
```

is used with:

```python
equal_var=False
```

The raw p-values are then adjusted **within each endpoint** using the Holm procedure.

Output columns include:

```text
endpoint
strain_1
strain_2
n_1
n_2
welch_t
p_raw
p_holm
```

### Why Welch?

It does not assume equal variances between the two strain groups.

### Important

These pairwise comparisons are explicitly described as **exploratory**, especially where some strains have small numbers of biological replicates.

---

# 16. PCA — exactly what is used

## Short answer

**Yes. Equivalent radius is used in the PCA, but not the raw radius time series.**

The PCA uses **strain-level mean replicate endpoints**.

The candidate variables are:

```text
area_rate_mm2_day
radial_rate_mm_day
final_area_mm2
final_radius_mm
mean_circularity
mean_aspect_ratio
mean_eccentricity
mean_solidity
mean_convexity
final_global_area_mm2
global_area_mm2_rate
final_satellite_area_mm2
final_satellite_fraction_global
```

Only variables that actually exist in `replicate_summary` are used.

### What happens before PCA?

For each strain:

1. replicate-level values are averaged;
2. variables are retained when they have sufficient coverage;
3. remaining missing values are filled with the median of that variable across strains;
4. all variables are standardized with:

```python
StandardScaler()
```

so every variable contributes on a common standardized scale.

Then:

```python
PCA(n_components=2)
```

is fitted to the standardized strain profiles.

### Therefore, the PCA contains:

**Size/growth variables**

- final central area;
- maximum central area;
- area expansion rate;
- final equivalent radius;
- equivalent-radius expansion rate.

**Morphology variables**

- mean circularity;
- mean aspect ratio;
- mean eccentricity;
- mean solidity;
- mean convexity.

**Global/satellite variables**

- final global area;
- global area expansion rate;
- final identifiable satellite area;
- final satellite fraction of global area.

### What is NOT used directly?

The PCA does **not** use:

- every image independently;
- every date independently;
- raw pixel values;
- perimeter directly;
- major axis directly;
- minor axis directly;
- Feret diameter directly;
- colony coordinates;
- the inoculation-origin coordinates;
- individual satellite identities.

The PCA is therefore a **strain-level summary of measured phenotype**, not an image-level PCA and not a genetic/taxonomic analysis.

### PCA interpretation

Each point represents one strain.

Nearby strains have more similar standardized phenotype profiles across the selected variables.

The percentage shown on PC1 and PC2 is the proportion of variance explained by those components.

The direction of a variable's contribution is **not shown in the current figure**, so the current PCA should be interpreted primarily as a map of multivariate strain similarity, not as a variable-loading plot.

---

# 17. Hierarchical clustering

The clustering uses **the exact same standardized strain profile matrix used by the PCA**.

That means it uses the same:

```text
profile_vars
```

the same strain-level means, the same median missing-value imputation, and the same z-standardization.

Clustering method:

```python
linkage(Xz, method="ward")
```

### Why Ward?

Ward's method groups strains while minimizing the increase in within-cluster variance.

The resulting dendrogram describes **similarity among measured phenotypes**.

It is not:

- a phylogeny;
- a taxonomic tree;
- a genetic-distance tree.

---

# 18. Automatic biological conclusions

## Block 16

The notebook generates text summaries from the calculated results.

These include:

- number of strains and biological replicates;
- whether replicate numbers are balanced;
- descriptive highest/lowest means for selected endpoints;
- whether any omnibus p-value is below `ALPHA`;
- number of satellite-positive replicates;
- median time to first identifiable satellite;
- count-decrease/area-increase patterns;
- confirmation that repeated observations were not treated as independent biological replicates;
- clarification that PCA/clustering is phenotypic rather than taxonomic.

The notebook deliberately avoids turning a descriptive difference into a claim of statistical significance.

---

# 19. Output tables

The notebook exports the following key tables.

### `replicate_growth_parameters.csv`

One row per biological replicate.

Contains:

- initial/final/max area;
- area growth rate and R²;
- initial/final/max equivalent radius;
- radial growth rate and R²;
- morphology summaries.

### `central_satellite_global_date_observations.csv`

One row per:

```text
strain × replicate × date
```

Contains:

- central area;
- satellite area;
- global area;
- identifiable satellite count;
- satellite fraction;
- mean identifiable satellite area.

### `satellite_replicate_summary.csv`

One row per biological replicate with satellite-specific endpoints.

### `global_replicate_growth_parameters.csv`

One row per biological replicate with longitudinal parameters for:

- central area;
- satellite area;
- global area.

### `strain_morphology_summary.csv`

Strain-level descriptive summaries for morphology.

### `strain_omnibus_statistics.csv`

ANOVA, eta-squared, and Kruskal–Wallis results for the six predefined growth endpoints.

### `pairwise_welch_holm.csv`

Exploratory pairwise Welch comparisons with Holm-adjusted p-values.

### `strain_phenotypic_profile.csv`

The strain-level phenotype matrix used as the basis for PCA and hierarchical clustering **before standardization**.

---

# 20. Main methodological safeguards

### Biological replicate is the experimental unit

Image/ROI rows are not treated as independent biological replicates.

### Repeated observations are longitudinal

Dates within the same replicate are used to construct trajectories and rates.

### Revision resolution occurs first

Older revisions of the same image are not allowed to enter the biological analysis alongside their newer revision.

### Central colony identity is explicit

The notebook uses the reviewed FungiGrowthJ classification rather than guessing which object is central.

### Satellite identity is conservative

Satellite counts refer to **individually distinguishable objects**, not guaranteed persistent biological entities.

### Morphology is not automatically validity

Low circularity, for example, remains a measured morphological phenotype and is not automatically discarded as biologically invalid.

### PCA is phenotypic

PCA and clustering summarize measured phenotype similarity; they do not infer taxonomy or genetic relatedness.

---

# 21. Important interpretation notes

## Equivalent radius is not a geometric measurement of colony distance from the plate center

It is an area-equivalent radius:

\[
r_{eq} = \sqrt{\frac{A}{\pi}}
\]

It represents the radius of a circle with the same area as the measured colony.

This makes it a useful scalar size metric for irregular colonies.

## Growth rates are linear descriptive slopes

The notebook calculates observed average slopes over the sampled interval.

It does not fit an exponential, logistic, Gompertz, Richards, or mechanistic growth model.

## Satellite count is a separability measurement

A drop in identifiable satellite count can occur because colonies merge or cease to be distinguishable.

## A final satellite fraction of zero is not necessarily "no satellites"

A replicate is included in the final satellite-fraction plot if it was satellite-positive at any observation. Its final value can therefore be zero.

---

# 22. Recommended GitHub documentation structure

For a public repository, this notebook can be documented with:

```text
FungiGrowthJ/
├── README.md
├── LICENSE
├── docs/
│   ├── USER_MANUAL.md
│   └── BIOLOGICAL_ANALYSIS_NOTEBOOK.md
├── notebooks/
│   └── FungiGrowthJ_Biological_Report_GENERIC_v4_SATELLITES_STYLED_EXECUTED.ipynb
├── examples/
│   └── results.zip
└── ...
```

This document is intended to become:

```text
docs/BIOLOGICAL_ANALYSIS_NOTEBOOK.md
```

---

# 23. Reproducibility

The notebook should be run from a clean environment with the declared Python dependencies installed.

For a published analysis, retain:

1. the exact FungiGrowthJ results ZIP;
2. the exact notebook version;
3. the FungiGrowthJ software version(s) reported in the result files;
4. the generated tables;
5. the generated figures;
6. the standalone HTML report.

This makes it possible to distinguish changes in the biological results from changes in the software or analysis workflow.
