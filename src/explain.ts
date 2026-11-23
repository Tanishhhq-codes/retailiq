/** Short "what is this data / why does it help" notes shown under each panel title. Keyed by panel title. */
export type Note = { what: string; why: string };

export const EXPLAIN: Record<string, Note> = {
  // Overview
  "Where the raw rows went": { what: "Every raw order row, split into clean, duplicate and quarantined.", why: "Shows how much of the data the figures rely on and that nothing disappears silently." },
  "Monthly revenue": { what: "Revenue per month: price x quantity less discount, fulfilled orders only.", why: "A line shows trend and seasonality; the shaded festive band and previous-period overlay show what changed." },
  "Category by month": { what: "Revenue for each product category in each month (dot size = strength).", why: "A grid reveals which categories drive which months, which a single line cannot." },
  "Revenue by category": { what: "Total revenue per product category.", why: "Ranked bars show where money comes from; clicking one filters the whole page." },
  "Revenue by country": { what: "Total revenue per customer country, after spelling variants are merged.", why: "Shows market concentration; merged names (USA, U.S.A) mean no country is split in two." },
  "Revenue by payment method": { what: "Total revenue per payment method.", why: "Shows which payment channels matter for the business." },
  "Best-selling product in each category": { what: "Top product by revenue inside every category, all time.", why: "Gives a quick list of hero products to stock and promote." },
  // Quality
  "Row reconciliation": { what: "Raw rows minus duplicates minus quarantined equals clean rows.", why: "Proves every row is accounted for exactly once." },
  "Where the removed rows went": { what: "Flow from the removed rows to the rule that rejected each one.", why: "Ribbon width shows which defect types cost the most data." },
  "Quality scorecard": { what: "Five quality dimensions scored before and after cleaning.", why: "A before/after view quantifies what the pipeline actually improved." },
  "A finding the labels did not contain": { what: "A defect the generator did not inject, found by checking the data itself.", why: "Shows the checks can find real problems, not just the ones they were built for." },
  "Raw completeness by column": { what: "Share of raw rows that have a value in each required column.", why: "Points to which columns lose data and need upstream fixes." },
  "Spelling variants found": { what: "Different spellings of the same country or status (UK, U.K., united kingdom).", why: "Repairing them stops one country or status from being counted as several." },
  "Detection against injected defects": { what: "For each rule, defects injected by the generator vs defects the pipeline found.", why: "Matching counts are the evidence that the cleaning rules are correct." },
  // Quarantine
  "Rejected rows": { what: "Each rejected row as raw text, with the rule that stopped it.", why: "Lets you audit every rejection and fix the source system. Values like 'two' stay visible." },
  // Customers
  "Customer segments": { what: "Customers grouped by RFM: how recently, how often and how much they buy.", why: "Different segments need different action, such as win-back for lapsed and rewards for champions." },
  "Recency against frequency": { what: "Count of customers at each recency score vs frequency score (5 = best).", why: "The heatmap shows whether customers are concentrated in loyal or at-risk corners." },
  "Segment detail": { what: "Customers, revenue and average spend per segment.", why: "Shows how much each segment is worth, to prioritise effort." },
  "Revenue by city": { what: "Revenue per customer city.", why: "Shows where demand is geographically, for logistics and local marketing." },
  "Revenue by loyalty tier": { what: "Revenue and spend per customer for each loyalty tier.", why: "Tests whether higher tiers really spend more, i.e. whether the programme works." },
  "Active customers per month": { what: "Distinct customers with at least one fulfilled order in each month.", why: "Separates growth from more customers vs bigger baskets from the same ones." },
  // Insights
  "Revenue forecast": { what: "Next months' revenue from a trend + festive-season model, with a 90% range.", why: "Supports planning; the range and hold-out error show how far to trust it." },
  "Daily revenue and unusual days": { what: "Revenue per day; days far from their neighbours' median are flagged.", why: "Flags spikes and dips (promotions, outages, bad data) worth investigating." },
  "Every day at a glance": { what: "One dot per day, darker = higher revenue; rings mark flagged days.", why: "Reveals weekly and seasonal patterns across two years in one view." },
  "Findings": { what: "Plain-language statements computed from the clean data.", why: "Turns charts into conclusions someone can act on." },
  // Pipeline
  "Five stages": { what: "Time taken by ingestion, cleaning, processing, storage and export.", why: "Shows where the run spends its time, so you know what to optimise." },
  "Storage: CSV against Parquet": { what: "File size of the same data as CSV vs Parquet.", why: "Shows the space saved by a columnar format." },
  "Query benchmark": { what: "Time to run the same queries on CSV vs Parquet.", why: "Shows the speed gain from the storage choice." },
  "Cleaning rules": { what: "The ordered validation rules loaded from rules.yaml.", why: "Rules are visible and editable without touching Spark code." },
  "Run history": { what: "A log of each pipeline run: rows, retention, duration, ground-truth match.", why: "Lets you spot regressions between runs." },
};
