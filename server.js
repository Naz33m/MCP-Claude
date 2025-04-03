const express = require("express");
const { Pool } = require("pg");
const bodyParser = require("body-parser");
const cors = require("cors");
const morgan = require("morgan");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// Configure middleware
app.use(cors());
app.use(bodyParser.json());
app.use(morgan("dev"));

// Create PostgreSQL connection pool
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

// Test database connection
pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("Database connection error:", err);
  } else {
    console.log("Connected to PostgreSQL database at:", res.rows[0].now);
  }
});

// Function to fetch all schemas
async function fetchSchemas() {
  const query = `
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema'
  `;
  const { rows } = await pool.query(query);
  return rows.map((row) => row.schema_name);
}

// Function to fetch tables in a schema
async function fetchTables(schema) {
  const query = `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = $1 AND table_type = 'BASE TABLE'
  `;
  const { rows } = await pool.query(query, [schema]);
  return rows.map((row) => row.table_name);
}

// Function to fetch table schema
async function fetchTableSchema(schema, table) {
  const query = `
    SELECT
      column_name,
      data_type,
      is_nullable,
      column_default,
      character_maximum_length
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position
  `;
  const { rows } = await pool.query(query, [schema, table]);
  return rows;
}

// Function to validate and run read-only SQL queries
async function executeReadOnlyQuery(sql) {
  // Simple check for read-only operations
  const normalizedSql = sql.trim().toLowerCase();

  if (
    normalizedSql.includes("insert ") ||
    normalizedSql.includes("update ") ||
    normalizedSql.includes("delete ") ||
    normalizedSql.includes("drop ") ||
    normalizedSql.includes("alter ") ||
    normalizedSql.includes("create ") ||
    normalizedSql.includes("truncate ")
  ) {
    throw new Error("Only read-only operations are allowed");
  }

  // Execute the query
  const result = await pool.query(sql);
  return result.rows;
}

// API Routes

// Get all schemas
app.get("/api/schemas", async (req, res) => {
  try {
    const schemas = await fetchSchemas();
    res.json(schemas);
  } catch (error) {
    console.error("Error fetching schemas:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get all tables in a schema
app.get("/api/schemas/:schema/tables", async (req, res) => {
  try {
    const tables = await fetchTables(req.params.schema);
    res.json(tables);
  } catch (error) {
    console.error("Error fetching tables:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get table schema
app.get("/api/schemas/:schema/tables/:table", async (req, res) => {
  try {
    const tableSchema = await fetchTableSchema(
      req.params.schema,
      req.params.table,
    );
    res.json(tableSchema);
  } catch (error) {
    console.error("Error fetching table schema:", error);
    res.status(500).json({ error: error.message });
  }
});

// Execute read-only query
app.post("/api/query", async (req, res) => {
  try {
    const { sql } = req.body;

    if (!sql) {
      return res.status(400).json({ error: "SQL query is required" });
    }

    const results = await executeReadOnlyQuery(sql);
    res.json(results);
  } catch (error) {
    console.error("Error executing query:", error);
    res.status(400).json({ error: error.message });
  }
});

// Data analysis prompts endpoint
app.get("/api/analysis-prompts", (req, res) => {
  const prompts = {
    basic: [
      {
        name: "Table Overview",
        description: "Get basic statistics about a table",
        query: "SELECT COUNT(*) as row_count FROM {schema}.{table}",
      },
      {
        name: "Column Statistics",
        description: "Get statistics for a numerical column",
        query:
          "SELECT MIN({column}) as min_value, MAX({column}) as max_value, AVG({column}) as avg_value, STDDEV({column}) as std_dev FROM {schema}.{table}",
      },
      {
        name: "Top Values",
        description: "Get the most frequent values in a column",
        query:
          "SELECT {column}, COUNT(*) as frequency FROM {schema}.{table} GROUP BY {column} ORDER BY frequency DESC LIMIT 10",
      },
      {
        name: "Time Series Analysis",
        description: "Group data by time period",
        query:
          "SELECT DATE_TRUNC('{period}', {timestamp_column}) as time_period, COUNT(*) FROM {schema}.{table} GROUP BY time_period ORDER BY time_period",
      },
    ],
    intermediate: [
      {
        name: "Correlation Analysis",
        description: "Calculate correlation between two numerical columns",
        query:
          "SELECT CORR({column1}, {column2}) as correlation FROM {schema}.{table}",
      },
      {
        name: "Percentile Analysis",
        description: "Calculate percentiles for a column",
        query:
          "SELECT\n  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY {column}) as percentile_25,\n  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY {column}) as median,\n  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY {column}) as percentile_75\nFROM {schema}.{table}",
      },
      {
        name: "Cohort Analysis",
        description: "Basic cohort analysis template",
        query:
          "WITH cohorts AS (\n  SELECT\n    user_id,\n    DATE_TRUNC('month', first_activity_date) as cohort_month,\n    DATE_TRUNC('month', activity_date) as activity_month\n  FROM {schema}.{table}\n)\nSELECT\n  cohort_month,\n  (DATE_PART('year', activity_month) - DATE_PART('year', cohort_month)) * 12 +\n  (DATE_PART('month', activity_month) - DATE_PART('month', cohort_month)) as months_since_cohort,\n  COUNT(DISTINCT user_id) as active_users\nFROM cohorts\nGROUP BY 1, 2\nORDER BY 1, 2",
      },
    ],
    advanced: [
      {
        name: "Retention Analysis",
        description: "Calculate user retention rates",
        query:
          "WITH cohort_items AS (\n  SELECT\n    user_id,\n    DATE_TRUNC('month', first_purchase_date) as cohort_month,\n    DATE_TRUNC('month', purchase_date) as purchase_month\n  FROM {schema}.{table}\n),\ncohort_size AS (\n  SELECT cohort_month, COUNT(DISTINCT user_id) as num_users\n  FROM cohort_items\n  GROUP BY 1\n),\nretention AS (\n  SELECT\n    c.cohort_month,\n    (DATE_PART('year', c.purchase_month) - DATE_PART('year', c.cohort_month)) * 12 +\n    (DATE_PART('month', c.purchase_month) - DATE_PART('month', c.cohort_month)) as months_since_cohort,\n    COUNT(DISTINCT c.user_id) as num_users\n  FROM cohort_items c\n  GROUP BY 1, 2\n)\nSELECT\n  r.cohort_month,\n  s.num_users as cohort_size,\n  r.months_since_cohort,\n  r.num_users as retained_users,\n  ROUND(r.num_users::NUMERIC / s.num_users, 2) as retention_rate\nFROM retention r\nJOIN cohort_size s ON r.cohort_month = s.cohort_month\nORDER BY 1, 3",
      },
      {
        name: "Funnel Analysis",
        description: "Analyze conversion through different stages",
        query:
          "WITH stages AS (\n  SELECT\n    user_id,\n    MAX(CASE WHEN stage = 'stage1' THEN 1 ELSE 0 END) as reached_stage1,\n    MAX(CASE WHEN stage = 'stage2' THEN 1 ELSE 0 END) as reached_stage2,\n    MAX(CASE WHEN stage = 'stage3' THEN 1 ELSE 0 END) as reached_stage3,\n    MAX(CASE WHEN stage = 'stage4' THEN 1 ELSE 0 END) as reached_stage4\n  FROM {schema}.{table}\n  GROUP BY user_id\n)\nSELECT\n  COUNT(*) as total_users,\n  SUM(reached_stage1) as stage1_count,\n  SUM(reached_stage2) as stage2_count,\n  SUM(reached_stage3) as stage3_count,\n  SUM(reached_stage4) as stage4_count,\n  ROUND(SUM(reached_stage1)::NUMERIC / COUNT(*), 2) as stage1_rate,\n  ROUND(SUM(reached_stage2)::NUMERIC / SUM(reached_stage1), 2) as stage1_to_stage2_rate,\n  ROUND(SUM(reached_stage3)::NUMERIC / SUM(reached_stage2), 2) as stage2_to_stage3_rate,\n  ROUND(SUM(reached_stage4)::NUMERIC / SUM(reached_stage3), 2) as stage3_to_stage4_rate,\n  ROUND(SUM(reached_stage4)::NUMERIC / COUNT(*), 2) as overall_conversion\nFROM stages",
      },
      {
        name: "RFM Analysis",
        description: "Calculate Recency, Frequency, Monetary metrics",
        query:
          "WITH rfm AS (\n  SELECT\n    customer_id,\n    CURRENT_DATE - MAX(purchase_date) as recency,\n    COUNT(order_id) as frequency,\n    SUM(amount) as monetary\n  FROM {schema}.{table}\n  WHERE purchase_date >= CURRENT_DATE - INTERVAL '1 year'\n  GROUP BY customer_id\n),\nrfm_quartiles AS (\n  SELECT\n    customer_id,\n    recency,\n    frequency,\n    monetary,\n    NTILE(4) OVER (ORDER BY recency DESC) as r_quartile,\n    NTILE(4) OVER (ORDER BY frequency) as f_quartile,\n    NTILE(4) OVER (ORDER BY monetary) as m_quartile\n  FROM rfm\n)\nSELECT\n  customer_id,\n  recency,\n  frequency,\n  monetary,\n  r_quartile,\n  f_quartile,\n  m_quartile,\n  CONCAT(r_quartile, f_quartile, m_quartile) as rfm_score\nFROM rfm_quartiles\nORDER BY rfm_score DESC",
      },
    ],
  };

  res.json(prompts);
});

// Simple frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "home.html"));
});

// Start the server
app.listen(port, () => {
  console.log(`MCP Server running on port ${port}`);
});

// Error handling for uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});
