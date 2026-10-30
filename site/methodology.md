# Synthetic Data Generation Methodology

## Mapping the Unmeasured: Compressive Strength of 3D-Printed Clay

## Table of contents

- [1. Purpose and scope](#1-purpose-and-scope)
- [2. Input space and data conventions](#2-input-space-and-data-conventions)
- [3. Definition of the response](#3-definition-of-the-response)
- [4. Deterministic conditional-mean model](#4-deterministic-conditional-mean-model)
- [5. Synthetic observation noise](#5-synthetic-observation-noise)
- [6. Reproducible numerical example](#6-reproducible-numerical-example)
- [7. Literature basis and evidence boundaries](#7-literature-basis-and-evidence-boundaries)
- [8. Interpretation of regression, optimization, and active learning](#8-interpretation-of-regression-optimization-and-active-learning)
- [9. Implementation, provenance, and safeguards](#9-implementation-provenance-and-safeguards)
- [10. Version history and superseded proposals](#10-version-history-and-superseded-proposals)
- [11. Limitations and future calibration](#11-limitations-and-future-calibration)

## 1. Purpose and scope

The dataset is a **literature-informed, physics-guided synthetic benchmark** for developing and demonstrating a regression–optimization–active learning proof of concept framework. It provides a reproducible simulated relationship between material and printing parameters and an illustrative compressive-strength response.

The labels are generated computationally. **They are not physical test measurements, and the generator has not been calibrated or validated for the project's clay material.** Literature motivates selected mechanisms and one external strength scale; it does not establish the complete seven-variable response function or the numerical values of the scenario coefficients.

The benchmark can support:

- regression against a known simulated response;
- searches for parameter combinations with a specified predicted strength;
- comparisons of sequential sampling and active learning within a fixed synthetic world;
- educational exploration of model error and changing model behaviour as training samples are added.

Performance on these data describes fidelity to the simulated world. It does not establish accuracy for real specimens, construction applications, or structural design.

## 2. Input space and data conventions

### 2.1 Seven model inputs

| Dataset field | Symbol | Candidate values | Interpretation |
| --- | --- | --- | --- |
| `State` | s | Dried, Fired | Material processing state |
| `Seams` | A | Random, Aligned | Seam arrangement; Random = 0, Aligned = 1 in the formula |
| `Walls` | N_w | 1, 2 | Number of perimeter wall paths |
| `Layer Height mm` | h | 1, 1.5, 2, 2.5, 3 | Layer height in mm |
| `Bead mm` | w | 3, 3.3, 3.6, 3.9, 4.2, 4.5 | Assumed deposited bead width in mm |
| `Infill Density` | D | 0.3, 0.5, 0.7, 0.9, 1 | Internal infill fraction |
| `Overlap` | o | 0.15, 0.35, 0.45, 0.65, 0.85, 1 | Project-defined overlap fraction |

In the synthetic CSV and XLSX files, D and o are already stored as fractions between 0 and 1. They enter the calculation directly: **do not divide them by 100 again**. For example, 0.5 means 50%.

The legacy `Original Design` worksheet uses percentage-valued input columns. Those values require a single division by 100 at that separate data-entry boundary. Unit interpretation follows the source schema, not a row-by-row guess based on magnitude.

The explicit value lists must be used when reconstructing the grid. Some intervals are unequal; a single range and step cannot reproduce every level.

### 2.2 Validity constraint and configuration count

The unconstrained Cartesian product contains:

$$
2\times2\times2\times5\times6\times5\times6=7{,}200
$$

configurations. The current project convention requires:

$$
D=1\quad\Longrightarrow\quad o=1.
$$

This is a project-specific parameter convention, not a universal rule for every slicer or printing process.

For the full-infill rows, overlap was set to 1 and duplicate input configurations were removed. Deduplication used the complete input vector X, not Y; existing synthetic labels were not averaged. The resulting dataset contains:

- 5,760 configurations with D < 1;
- 240 configurations with D = 1 and o = 1;
- **6,000 unique configurations in total**.

The current generator rejects D = 1 with o ≠ 1. Coverage of this discrete grid does not imply coverage of the continuous design space or establish that every candidate can be printed successfully.

### 2.3 Fixed geometry and protocol

Every synthetic row carries the following fixed geometry:

| Field | Value |
| --- | --- |
| `Section Length mm` | 80 mm |
| `Section Width mm` | 80 mm |
| `Section Area mm2` | 6,400 mm² |

These are protocol constants, not additional model inputs. The generator checks consistency between the prescribed dimensions and area.

Loading is recorded as **parallel to the printing direction**, as specified for this project. This does not establish the angle to the build axis, layer planes, or every individual infill segment. No additional direction multiplier is applied.

The seven inputs do not encode the complete clay formulation, firing schedule, drying environment, infill topology, extrusion flow, printing speed, specimen height, or dimensional changes during drying and firing. The synthetic calculation does not resolve these missing physical conditions. Their real-world influence must not be inferred from this benchmark.

### 2.4 Stable sample identifiers

The configurations are identified by `Sample ID`, from `CLAY-000001` to `CLAY-006000`. Identifiers were assigned once to the existing rows and remain attached to those configurations after sorting, filtering, or label regeneration.

Sample identifiers are used for tracking and joining records. They are **not model features**, do not enter the strength equation, and do not determine the random-noise key. New configurations should receive unused identifiers rather than triggering renumbering of existing samples.

## 3. Definition of the response

The intended physical quantity is gross-area apparent compressive strength:

$$
f_{c,\mathrm{gross}}=\frac{F_{\max}}{A_{\mathrm{gross,test}}}.
$$

With force in N and area in mm², the result is expressed in MPa. A real experiment would require the actual external loaded area at the time of testing. Gross-area strength must not be mixed with net-area strength, interlayer tensile strength, flexural strength, or foam plateau stress.

The synthetic dataset uses a prescribed geometry and a hypothetical strength function; it does not derive its labels from measured failure forces. The use of MPa indicates the assumed numerical scale, not physical validation.

The current implementation distinguishes:

- **μ(X):** the deterministic conditional mean specified by the scenario;
- **Y(X):** the stored synthetic observation, obtained by multiplying μ(X) by a reproducible random-noise factor.

## 4. Deterministic conditional-mean model

### 4.1 Approximate material fraction

Perimeter wall thickness is approximated by:

$$
t_w=N_w w.
$$

For a rectangular section of length L and width B, the perimeter-wall area fraction is:

$$
\phi_w=1-\frac{(L-2t_w)(B-2t_w)}{LB}.
$$

The approximate material fraction combines the perimeter walls with the internal infill:

$$
r=\phi_w+(1-\phi_w)D.
$$

For the prescribed L = B = 80 mm section, this becomes:

$$
\boxed{r=1-(1-D)\left(1-\frac{N_w w}{40}\right)^2.}
$$

The denominator 40 has units of mm and comes from half the section width. It is not a percentage-conversion factor.

This geometric approximation assumes that wall thickness can be represented by wall count times bead width and that slicer infill is a usable proxy for internal material fraction. It does not account explicitly for neighbouring-wall overlap, infill intersections, top and bottom solid layers, microscopic bead porosity, cracking, or shrinkage. The condition

$$
0<2t_w<\min(L,B)
$$

must hold. A more physical implementation would obtain deposited material geometry from the G-code or measured specimens and avoid double-counting overlapping paths.

### 4.2 Material-state strength scale

The dried-state scale is:

$$
F_{\mathrm{ref,Dried}}=3.08\left[1-\exp(-0.14\times7)\right]
\approx1.924041816\ \mathrm{MPa}.
$$

The adopted time-response expression is documented in the project literature review under [S1](https://doi.org/10.2174/0118748368499190260928170736). It originates from a different clay formulation and experimental protocol. Its use here is an **assumed transfer of an external numerical scale**, not calibration to the project's clay or specimen geometry.

For the current illustrative scenario:

$$
F_{\mathrm{ref,Fired}}=3F_{\mathrm{ref,Dried}}
\approx5.772125447\ \mathrm{MPa}.
$$

The factor of 3 is a deliberately selected scenario assumption. It is not an experimentally established firing benefit, a literature-derived universal multiplier, or a result learned from project measurements.

F_ref is the multiplicative scale in the equation below. It should not be interpreted as the predicted strength of every full-infill configuration. The analytical normalization constants do not jointly define a valid full-infill row in the current grid: o = 0.35 is excluded when D = 1.

### 4.3 Seam, overlap, and layer-to-bead-ratio terms

Define:

$$
A=\begin{cases}0,&\text{Random seams},\\1,&\text{Aligned seams},\end{cases}
\qquad q_0=\frac{1.8}{4.2}=\frac37,
\qquad o_0=0.35.
$$

The deterministic conditional mean is:

$$
\boxed{\mu(X)=F_{\mathrm{ref},s}\,r^{1.5}
\exp\left[-0.1A+(o-0.35)-\left(\frac{h}{w}-\frac37\right)^2\right].}
$$

All terms inside the exponential are dimensionless. The ratio h/w uses lengths expressed in the same unit.

| Parameter or term | Current value or form | Evidence boundary |
| --- | --- | --- |
| Material-fraction exponent | 1.5 | Uncalibrated structural scenario; not a validated clay exponent |
| Aligned-seam term | exp(−0.1 A) | Assumes an approximately 9.5% reduction relative to Random at otherwise identical inputs |
| Overlap term | exp[o − 0.35] | Assumes a continuous positive overlap response with coefficient 1 |
| Layer-ratio term | exp[−(h/w − 3/7)²] | Assumes a symmetric penalty around an analytical reference ratio |
| Fired-to-dried scale ratio | 3 | Illustrative, uncalibrated state difference |

The layer-height reference of 1.8 mm is not a level in the current candidate grid. It remains an analytical parameter; it is not presented as a sampled configuration or a demonstrated physical optimum.

The overlap term is a **relative correction**, not solely a reduction factor: it equals 1 at o = 0.35 and exceeds 1 above that value. Geometry r is not increased separately by overlap, avoiding an additional unsupported material-area contribution.

For otherwise fixed valid inputs with D < 1:

$$
\frac{\mu(o_2)}{\mu(o_1)}=\exp(o_2-o_1).
$$

For example, increasing o from 0.15 to 0.35 raises the conditional mean by about 22.14% within this scenario. This follows from the chosen coefficient, not a measured material effect. At D = 1, only o = 1 is admissible, so an overlap sweep at full infill is not part of the current valid dataset.

The formula can represent larger wall fractions or infill fractions as stronger configurations, an aligned-seam penalty, an overlap response, and a preferred layer-to-bead ratio. These properties are imposed by construction. Recovering them with machine learning does not independently establish them as physical laws.

## 5. Synthetic observation noise

### 5.1 Mean-preserving multiplicative lognormal noise

Each stored observation is generated as:

$$
\boxed{Y(X)=\mu(X)\exp\left(\sigma Z-\frac{\sigma^2}{2}\right),
\qquad Z\sim\mathcal N(0,1),}
$$

with:

$$
\sigma=\sqrt{\ln(1+0.20^2)}\approx0.19804220043536505.
$$

The subtraction of σ²/2 preserves the conditional mean:

$$
\mathbb E[Y\mid X]=\mu(X),
\qquad
\operatorname{SD}(Y\mid X)=0.20\,\mu(X).
$$

The generated observations remain positive. The 20% value is a conditional coefficient of variation, **not a ±20% bound**; individual deviations can exceed 20%.

Noise increases absolute variability at higher mean strengths. It represents an illustrative combination of unmodelled specimen variability and observation scatter. It is not a measured variability estimate and must not be attributed entirely to instrument error.

### 5.2 Reproducibility and random keys

The current noise seed is:

```text
20261025
```

For each row, the generator constructs a canonical key from the seed, `State`, `Seams`, and the normalized numeric values of:

```text
Walls
Layer Height mm
Bead mm
Infill Density
Overlap
Section Length mm
Section Width mm
Section Area mm2
```

It serializes this key using the implementation's JSON convention, hashes it with SHA-256, and uses the hash-derived integer to initialize a row-specific pseudorandom generator. One standard-normal draw supplies Z.

Consequently:

- the same inputs, protocol values, seed, and implementation reproduce the same stored observation;
- sorting or selecting a subset of rows does not change their labels;
- `Sample ID` does not change the noise realization;
- changing the seed defines another simulated realization, rather than another physical experiment.

The seed must not be repeatedly selected to obtain a preferred ML score. The current dataset retains one observation per configuration. It does not simulate replicate tests, shared batch effects, or correlated process errors.

### 5.3 Mean response versus stored observations

The function `strength()` returns the deterministic conditional mean and its components. `noisy_strength()` returns the observation written to the dataset.

Regeneration starts from μ(X), not from an already noisy label. This prevents accidental repeated multiplication of noise. The dataset does not add latent means, Z values, or noise multipliers as model inputs, which would leak information about the generated target.

Monotonicity of the mean function does not guarantee monotonicity of individual noisy observations. Adding observation noise changes achievable prediction accuracy without increasing the complexity of the conditional-mean function.

## 6. Reproducible numerical example

Consider this valid candidate configuration:

| Input | Value |
| --- | --- |
| State | Dried |
| Seams | Random |
| Walls | 1 |
| Layer height | 2 mm |
| Bead width | 3.6 mm |
| Infill density | 0.5 |
| Overlap | 0.35 |
| Section | 80 × 80 mm |

The implemented generator gives:

| Quantity | Value |
| --- | --- |
| Approximate wall thickness t_w | 3.6 mm |
| Wall-area fraction φ_w | 0.171900 |
| Material fraction r | 0.585950 |
| Exponential process factor η | 0.9840043428 |
| Dried-state scale F_ref | 1.9240418155 MPa |
| Conditional mean μ(X) | 0.8491850885 MPa |
| Keyed standard-normal draw Z | 0.6144093732 |
| Noise multiplier | 1.1074594715 |
| Stored synthetic observation Y | 0.9404380693 MPa |

These values were checked against the current Python implementation and configuration when preparing this edition. They illustrate the generator; they are not results from a compression test. The observation and latent mean are distinct quantities, so a model prediction need not exactly equal either one.

## 7. Literature basis and evidence boundaries

The original review distinguishes:

- **A:** measurements from the project's own material and protocol;
- **B:** external evidence directly concerning clay compression;
- **C:** structural analogies or evidence from other materials and response quantities;
- **D:** uncalibrated scenario assumptions.

The implemented generator is not calibrated using category-A measurements. Category-B or category-C mechanisms do not, by themselves, validate category-D numerical coefficients.

The following references and assessments are carried over from the source review. Where full text was unavailable, that limitation remains; no additional validation is implied by inclusion in this document.

| ID | Reference | Role in the methodology | Transfer limitation |
| --- | --- | --- | --- |
| S1 | Rihani et al. (2026), *Toward Sustainable Clay-based Additive Manufacturing: Fresh-State and Hardened Mechanical Characterization of 3D-Printable Benjellik Clay Paste*. [DOI](https://doi.org/10.2174/0118748368499190260928170736) | The source review records the drying-time expression 3.08[1 − exp(−0.14t)] MPa and seven-day compression results for an external clay. | Different material and test conditions; the reported specimen size is 40 mm. It does not calibrate this project's 80 mm geometry or seven-variable response. |
| S2 | Nuryanta et al. (2025), *Optimization of Kaolin Clay Composition for Enhanced Mechanical Properties in 3D-Printed Structures*. [DOI](https://doi.org/10.3390/constrmater5040083) | The source review records a reported maximum fired compressive strength of 6.14 MPa for a particular formulation; full conditions were not fully reviewed. | A maximum from another material is not a reference mean and is not used to derive the factor of 3. |
| S3 | Donyadari, Ferruzca Ortiz and Khondoker (2024), *Optimization of Printing Parameters for Extrusion 3D Printing of Ceramic Clay*. [DOI](https://doi.org/10.3390/engproc2024076047) | Motivates attention to coupling between layer height, bead geometry, flow, and printing quality. | The source review did not identify compression data suitable for calibrating the present strength coefficients and flagged questionable density units or magnitudes. |
| S4 | Ashby (2006), *The properties of foams and lattices*. [DOI](https://doi.org/10.1098/rsta.2005.1678) | Motivates consideration of relative density, topology, and failure mode in candidate structural relationships. | Foam or lattice scaling does not establish a universal exponent for dense printed clay. Some brittle relationships normalize by strut flexural strength rather than matrix compressive strength. |
| S5 | Ryshkewitch (1953), *Compression Strength of Porous Sintered Alumina and Zirconia*. [DOI](https://doi.org/10.1111/j.1151-2916.1953.tb12837.x) | A historical source for considering strength–microporosity relationships; the source review had abstract/bibliographic access rather than a full-text verification. | Alumina and zirconia are not the project's clay. Bead microporosity is not equivalent to one minus slicer infill. No additional microporosity factor is applied in the current generator. |
| S6 | de la Flor Juncal et al. (2024), *Influence of printing parameters on the durability of 3D-printed limestone calcined clay cement mortar: overlap between filaments and nozzle offset*. [DOI](https://doi.org/10.1617/s11527-024-02451-6) | Supports considering contact geometry, interface voids, overlap, and deformation as possible mechanisms. | LC3 cement mortar, durability responses, and millimetre-scale filament overlap do not supply a coefficient for this project's clay overlap fraction. |
| S7 | Chen et al. (2020), *Effect of printing parameters on interlayer bond strength of 3D printed limestone-calcined clay-based cementitious materials: An experimental and numerical study*. [DOI](https://doi.org/10.1016/j.conbuildmat.2020.120094) | Motivates attention to interface defects and process timing. | Cementitious interlayer tensile behaviour is not bulk clay compression; seam alignment is not synonymous with an ordinary layer interface. |
| S8 | Mamatha et al. (online 2019; issue 2020), *3D printing of cordierite honeycomb structures and evaluation of compressive strength under quasi-static condition*. [DOI](https://doi.org/10.1111/ijac.13399) | Supports documenting cell topology and failure mode in ceramic compression studies. | Different ceramic composition and structural geometry; no project-specific regression coefficients are transferred. |
| S9 | Ji, Poullain and Leklou (2025), *Mechanical Properties of 3D-Printed Earth-Based Materials Considering Two Printable Soils*. [DOI](https://doi.org/10.1061/JMCEE7.MTENG-19828) | Identified in the source review as a candidate for further direct earth-material evidence. | Access limitations prevented adequate review; no numerical values or directional coefficients from this source are used. |

The more detailed source-by-source record is available in the project evidence matrix (project file: `0_Dataset/research/clay_synthetic_strength/EVIDENCE_MATRIX.md`).

## 8. Interpretation of regression, optimization, and active learning

The synthetic generator defines the simulated world. A regression model learns an approximation to its stored observations. Optimization or targeting searches that approximation for favourable or specified responses. Active learning chooses which synthetic configurations to label next.

These activities should be described as **simulated active learning** when the queried labels come from the generator or a frozen synthetic lookup table.

For meaningful comparisons:

1. Keep the synthetic world, candidate pool, label-access policy, initial sample budget, and held-out evaluation procedure explicit.
2. Keep duplicate or repeated configurations within the same split. A row identifier must not replace configuration-based grouping.
3. Keep held-out test labels out of training, acquisition decisions, hyperparameter selection, and stopping decisions.
4. Compare acquisition strategies under equal budgets; use repeated sampling seeds when assessing stability rather than relying on one trajectory.
5. Distinguish model error against noisy observations from approximation error against the latent mean. Latent information is available to the simulator but must not leak into model inputs or acquisition unless explicitly permitted by the experiment design.
6. Treat feature importance and SHAP values as explanations of the chosen synthetic world. A recovered seam penalty is not independent experimental evidence that real aligned seams are weaker.

The 20% observation-noise setting is not a calibrated confidence interval. Likewise, alternative parameter scenarios are not calibrated uncertainty bounds for real clay. Agreement among models, or improved test scores after adding synthetic samples, does not remove uncertainty about the validity of the generator itself.

## 9. Implementation, provenance, and safeguards

The current files, with paths relative to this document, are:

| File | Role |
| --- | --- |
| Synthetic/generate_synthetic_y.py (project file: `0_Dataset/Synthetic/generate_synthetic_y.py`) | Implements the conditional mean, keyed noise, input validation, and controlled label generation |
| Synthetic/synthetic_y_config.json (project file: `0_Dataset/Synthetic/synthetic_y_config.json`) | Records model version, scenario coefficients, protocol assumptions, noise distribution, and seed |
| Synthetic/synthetic_y_generation_report.json (project file: `0_Dataset/Synthetic/synthetic_y_generation_report.json`) | Records the generation procedure, checks, output hashes, and scenario provenance |
| Synthetic/Synthetic_Dataset_6000.csv (project file: `0_Dataset/Synthetic/Synthetic_Dataset_6000.csv`) | Current input configurations and synthetic strength observations |
| Synthetic/Synthetic_Dataset_6000.xlsx (project file: `0_Dataset/Synthetic/Synthetic_Dataset_6000.xlsx`) | Workbook counterpart of the synthetic dataset |

The generator checks expected row count, required fields, finite inputs, supported state and seam categories, valid geometry, unique configurations, full-infill consistency, and nonblank unique sample identifiers when present. It rejects invalid values rather than silently clipping them.

By default, it refuses to overwrite existing nonblank target values. Intentional replacement of known synthetic labels requires an explicit option. Outputs are staged and checked before replacement; prior files are backed up, and replacement failure triggers rollback.

**The generator must not be used to overwrite physical measurements.** Real observations should remain in a clearly identified field or separate dataset with their own experimental provenance.

The following command is recorded for reproducibility; running it replaces existing synthetic labels and is not necessary to read this methodology or use the website:

```sh
python3 0_Dataset/Synthetic/generate_synthetic_y.py --replace-existing-synthetic
```

The implementation uses project-specific workbook-editing dependencies. The command is an implementation reference, not a claim that the script is dependency-free.

### Source integrity at preparation of this edition

| Source | SHA-256 |
| --- | --- |
| `Synthetic/generate_synthetic_y.py` | `6b413472fbe00e33bd95bd50d6eb16c325a9267579badf415a75340d89f0386f` |
| `Synthetic/synthetic_y_config.json` | `3599da2f3ef14eeab281685958a632e21e70d2ff08c270fc7e9ca4722a33e3b6` |
| `Synthetic/Synthetic_Dataset_6000.csv` | `e79d5b712665ca6d30cf61bda7d20af7f27a41c350f18fd6e004c0515c6a5965` |

The generator is byte-identical to the frozen `label_generator.py` used by the adaptive-tuning branch. The CSV is byte-identical to that branch's frozen `source_data.csv` and the website's local reference copy, as checked during preparation.

## 10. Version history and superseded proposals

| Stage | Meaning and status |
| --- | --- |
| Earlier M0 proposal | A minimal-mechanism baseline with η = 1 and alternative density exponents. Useful for sensitivity analysis, but not the active label generator. |
| Earlier M1 proposal | Included a one-sided low-overlap term proportional to (1 − D) max(o₀ − o, 0), with no default nonzero observation noise. Superseded for the current dataset. |
| Geometry update | Set the project's prescribed section to 80 × 80 mm. It did not establish specimen height, shrinkage correction, or a calibrated size effect. |
| Fraction-valued 7,200-row grid | Used explicit input levels with D and o stored as fractions. This describes the earlier unconstrained grid, not the final dataset count. |
| v0.6 mean response | Adopted the continuous exp[o − 0.35] overlap correction, the fixed loading-direction description, and the current illustrative state scales and process coefficients. This is the mean-response basis retained in v0.7. |
| Full-infill constraint and deduplication | Required D = 1 to have o = 1 and reduced the candidate set to 6,000 unique configurations. |
| v0.7 observation labels | Added mean-preserving multiplicative lognormal noise with conditional CV = 20% and seed 20261025. This is the current stored-label scenario. |
| Sample identifiers, 26 October 2026 | Added stable `Sample ID` values without changing the response equation or noise key. |

Earlier statements that targets were blank, that no generator script existed, or that the dataset contained 7,200 rows describe historical stages. They do not describe the implemented v0.7 dataset. Likewise, an earlier illustrative loading direction or an earlier overlap equation must not be combined with the current specification as though they were simultaneously active.

## 11. Limitations and future calibration

The generator assumes a particular relationship between wall geometry, infill, seam arrangement, layer ratio, overlap, and material state. Its coefficients, external-scale transfer, fired multiplier, and observation variability remain uncalibrated for the project's clay.

A physically grounded follow-up would require controlled compression tests, documented actual geometry and loading conditions, replicated specimens to estimate variability, and independent data to assess generalization. Useful matched comparisons include full versus partial infill, dried versus fired states, aligned versus random seams under otherwise matched printing conditions, and controlled changes in layer geometry and overlap.

Initial calibration should constrain the strength scale and structural relationship before adding more defect coefficients. Real measurements used for final independent evaluation should not also be used to select synthetic assumptions or tune the predictive model.

**Educational-use statement:** This methodology and the associated application demonstrate a regression–optimization–active learning proof of concept framework. Synthetic labels, model predictions, and suggested parameter combinations must not be used to guide real-world construction, structural design, or other safety-critical applications.

For questions, contact [w.xiang@student.tudelft.nl](mailto:w.xiang@student.tudelft.nl).
