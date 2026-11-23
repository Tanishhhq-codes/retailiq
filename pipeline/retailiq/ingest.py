"""Stage 1: ingestion. Everything in orders.csv is read as text so bad values stay visible."""
import os
from pyspark.sql import functions as F
from pyspark.sql.types import StructType, StructField, StringType


def read_sources(spark, cfg, root):
    raw_dir = os.path.join(root, cfg["paths"]["raw"])
    cols = cfg["ingest"]["order_columns"]
    schema = StructType([StructField(c, StringType(), True) for c in cols]
                        + [StructField("_corrupt", StringType(), True)])
    orders = (spark.read.option("header", True).option("mode", "PERMISSIVE")
              .option("columnNameOfCorruptRecord", "_corrupt").schema(schema)
              .csv(os.path.join(raw_dir, "orders.csv")))
    customers = spark.read.json(os.path.join(raw_dir, "customers.json"))
    products = (spark.read.option("header", True).option("inferSchema", True)
                .csv(os.path.join(raw_dir, "products.csv")))
    return orders, customers, products


def profile(raw, cols):
    """Blank/null counts per column plus distinct spellings, measured before any cleaning."""
    blanks = raw.select([F.sum(F.when(F.col(c).isNull() | (F.trim(F.col(c)) == ""), 1).otherwise(0)).alias(c)
                         for c in cols]).collect()[0].asDict()
    return {
        "null_profile": {k: int(v) for k, v in blanks.items()},
        "distinct_country_raw": raw.select("country").distinct().count(),
        "distinct_status_raw": raw.select("status").distinct().count(),
    }
