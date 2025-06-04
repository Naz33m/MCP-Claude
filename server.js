const express = require("express");
const { Pool } = require("pg");
const bodyParser = require("body-parser");
const cors = require("cors");
const morgan = require("morgan");
const dotenv = require("dotenv");
const path = require("path");

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// Configure middleware
app.use(cors());
app.use(bodyParser.json());
app.use(morgan("dev"));
app.use(express.static(path.join(__dirname, "public")));

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
    ],
    advanced: [
      {
        name: "RFM Analysis",
        description: "Calculate Recency, Frequency, Monetary metrics",
        query:
          "WITH rfm AS (\n  SELECT\n    customer_id,\n    CURRENT_DATE - MAX(purchase_date) as recency,\n    COUNT(order_id) as frequency,\n    SUM(amount) as monetary\n  FROM {schema}.{table}\n  WHERE purchase_date >= CURRENT_DATE - INTERVAL '1 year'\n  GROUP BY customer_id\n)\nSELECT *\nFROM rfm\nORDER BY monetary DESC",
      },
    ],
  };

  res.json(prompts);
});

// Home page with separate JS file
app.get("/", (req, res) => {
  // res.send(`
  //   <!DOCTYPE html>
  //   <html>
  //   <head>
  //     <title>PostgreSQL Data Explorer</title>
  //     <style>
  //       body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.6; }
  //       h1, h2 { color: #333; }
  //       pre { background: #f4f4f4; padding: 10px; border-radius: 5px; overflow: auto; }
  //       button { padding: 8px 12px; background: #4CAF50; color: white; border: none; cursor: pointer; margin: 5px; }
  //       input, select, textarea { padding: 8px; margin: 5px 0; width: 100%; box-sizing: border-box; }
  //       .container { display: flex; }
  //       .sidebar { width: 25%; padding-right: 20px; }
  //       .main { width: 75%; }
  //       table { border-collapse: collapse; width: 100%; }
  //       th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
  //       th { background-color: #f2f2f2; }
  //       .schema-item, .table-item, .prompt-category, .prompt-item {
  //         cursor: pointer;
  //         margin: 5px 0;
  //       }
  //       .tables-container, .prompts-container {
  //         padding-left: 20px;
  //         display: none;
  //       }
  //       .schema-item:hover, .table-item:hover, .prompt-category:hover, .prompt-item:hover {
  //         color: #4CAF50;
  //       }
  //       .error { color: red; }
  //     </style>
  //   </head>
  //   <body>
  //     <h1>PostgreSQL Data Explorer</h1>
  //     <div class="container">
  //       <div class="sidebar">
  //         <h2>Database Objects</h2>
  //         <div id="schemas"></div>
  //         <hr>
  //         <h2>Analysis Prompts</h2>
  //         <div id="prompts"></div>
  //       </div>
  //       <div class="main">
  //         <h2>SQL Query</h2>
  //         <textarea id="sqlQuery" rows="6" placeholder="Enter your SQL query here..."></textarea>
  //         <button id="executeBtn">Execute Query</button>
  //         <h2>Results</h2>
  //         <div id="results"></div>
  //       </div>
  //     </div>

  //     <script>
  //       // DOM elements
  //       const schemasDiv = document.getElementById('schemas');
  //       const promptsDiv = document.getElementById('prompts');
  //       const sqlQueryTextarea = document.getElementById('sqlQuery');
  //       const executeBtn = document.getElementById('executeBtn');
  //       const resultsDiv = document.getElementById('results');

  //       // Load schemas
  //       fetch('/api/schemas')
  //         .then(response => response.json())
  //         .then(schemas => {
  //           schemas.forEach(schema => {
  //             const div = document.createElement('div');
  //             div.className = 'schema-item';
  //             div.textContent = schema;
  //             div.onclick = () => loadTables(schema, div);
  //             schemasDiv.appendChild(div);
  //           });
  //         })
  //         .catch(error => {
  //           console.error('Error loading schemas:', error);
  //           schemasDiv.innerHTML = '<div class="error">Error loading schemas</div>';
  //         });

  //       // Load tables for a schema
  //       function loadTables(schema, schemaDiv) {
  //         // Check if tables are already loaded
  //         let tablesContainer = schemaDiv.nextElementSibling;

  //         if (tablesContainer && tablesContainer.className === 'tables-container') {
  //           // Toggle visibility
  //           tablesContainer.style.display = tablesContainer.style.display === 'none' ? 'block' : 'none';
  //           return;
  //         }

  //         // Create container for tables
  //         tablesContainer = document.createElement('div');
  //         tablesContainer.className = 'tables-container';

  //         // Fetch tables
  //         fetch('/api/schemas/' + encodeURIComponent(schema) + '/tables')
  //           .then(response => response.json())
  //           .then(tables => {
  //             tables.forEach(table => {
  //               const div = document.createElement('div');
  //               div.className = 'table-item';
  //               div.textContent = table;
  //               div.onclick = (e) => {
  //                 e.stopPropagation();
  //                 loadTableSchema(schema, table);
  //               };
  //               tablesContainer.appendChild(div);
  //             });

  //             // Insert after schema div
  //             schemaDiv.parentNode.insertBefore(tablesContainer, schemaDiv.nextSibling);
  //           })
  //           .catch(error => {
  //             console.error('Error loading tables:', error);
  //             tablesContainer.innerHTML = '<div class="error">Error loading tables</div>';
  //             schemaDiv.parentNode.insertBefore(tablesContainer, schemaDiv.nextSibling);
  //           });
  //       }

  //       // Load table schema
  //       function loadTableSchema(schema, table) {
  //         fetch('/api/schemas/' + encodeURIComponent(schema) + '/tables/' + encodeURIComponent(table))
  //           .then(response => response.json())
  //           .then(columns => {
  //             // Create table header
  //             let html = '<h3>Table: ' + schema + '.' + table + '</h3>';
  //             html += '<table><tr><th>Column Name</th><th>Data Type</th><th>Nullable</th><th>Default</th><th>Max Length</th></tr>';

  //             // Add rows for each column
  //             columns.forEach(column => {
  //               html += '<tr>';
  //               html += '<td>' + (column.column_name || '') + '</td>';
  //               html += '<td>' + (column.data_type || '') + '</td>';
  //               html += '<td>' + (column.is_nullable || '') + '</td>';
  //               html += '<td>' + (column.column_default || '') + '</td>';
  //               html += '<td>' + (column.character_maximum_length || '') + '</td>';
  //               html += '</tr>';
  //             });

  //             html += '</table>';

  //             // Add button to generate query
  //             const button = document.createElement('button');
  //             button.textContent = 'Generate SELECT Query';
  //             button.onclick = () => generateSelectQuery(schema, table);

  //             // Display results
  //             resultsDiv.innerHTML = html;
  //             resultsDiv.appendChild(button);
  //           })
  //           .catch(error => {
  //             console.error('Error loading table schema:', error);
  //             resultsDiv.innerHTML = '<div class="error">Error loading table schema</div>';
  //           });
  //       }

  //       // Generate SELECT query
  //       function generateSelectQuery(schema, table) {
  //         fetch('/api/schemas/' + encodeURIComponent(schema) + '/tables/' + encodeURIComponent(table))
  //           .then(response => response.json())
  //           .then(columns => {
  //             const columnNames = columns.map(c => c.column_name).join(', ');
  //             sqlQueryTextarea.value = 'SELECT ' + columnNames + '\nFROM ' + schema + '.' + table + '\nLIMIT 100;';
  //           })
  //           .catch(error => {
  //             console.error('Error generating query:', error);
  //             sqlQueryTextarea.value = '-- Error generating query';
  //           });
  //       }

  //       // Execute SQL query
  //       executeBtn.addEventListener('click', () => {
  //         const sql = sqlQueryTextarea.value;

  //         if (!sql.trim()) {
  //           resultsDiv.innerHTML = '<div class="error">Please enter a SQL query</div>';
  //           return;
  //         }

  //         fetch('/api/query', {
  //           method: 'POST',
  //           headers: { 'Content-Type': 'application/json' },
  //           body: JSON.stringify({ sql })
  //         })
  //         .then(response => response.json())
  //         .then(data => {
  //           if (data.error) {
  //             resultsDiv.innerHTML = '<div class="error">' + data.error + '</div>';
  //             return;
  //           }

  //           if (data.length === 0) {
  //             resultsDiv.innerHTML = '<div>Query executed successfully. No results returned.</div>';
  //             return;
  //           }

  //           // Build results table
  //           let html = '<h3>Query Results (' + data.length + ' rows)</h3>';
  //           html += '<table><tr>';

  //           // Headers
  //           const headers = Object.keys(data[0]);
  //           headers.forEach(header => {
  //             html += '<th>' + header + '</th>';
  //           });
  //           html += '</tr>';

  //           // Data rows
  //           data.forEach(row => {
  //             html += '<tr>';
  //             headers.forEach(header => {
  //               const value = row[header] !== null ? String(row[header]) : '<i>null</i>';
  //               html += '<td>' + value + '</td>';
  //             });
  //             html += '</tr>';
  //           });

  //           html += '</table>';
  //           resultsDiv.innerHTML = html;
  //         })
  //         .catch(error => {
  //           console.error('Error executing query:', error);
  //           resultsDiv.innerHTML = '<div class="error">Error executing query</div>';
  //         });
  //       });

  //       // Load analysis prompts
  //       fetch('/api/analysis-prompts')
  //         .then(response => response.json())
  //         .then(prompts => {
  //           Object.entries(prompts).forEach(([category, categoryPrompts]) => {
  //             // Create category header
  //             const categoryDiv = document.createElement('div');
  //             categoryDiv.className = 'prompt-category';
  //             categoryDiv.textContent = category.charAt(0).toUpperCase() + category.slice(1);

  //             // Create prompts container
  //             const promptsContainer = document.createElement('div');
  //             promptsContainer.className = 'prompts-container';

  //             // Add click handler to toggle visibility
  //             categoryDiv.onclick = () => {
  //               promptsContainer.style.display = promptsContainer.style.display === 'none' ? 'block' : 'none';
  //             };

  //             // Add prompts to container
  //             categoryPrompts.forEach(prompt => {
  //               const promptDiv = document.createElement('div');
  //               promptDiv.className = 'prompt-item';
  //               promptDiv.textContent = prompt.name;
  //               promptDiv.title = prompt.description;

  //               promptDiv.onclick = (e) => {
  //                 e.stopPropagation();
  //                 sqlQueryTextarea.value = prompt.query;
  //               };

  //               promptsContainer.appendChild(promptDiv);
  //             });

  //             // Add to DOM
  //             promptsDiv.appendChild(categoryDiv);
  //             promptsDiv.appendChild(promptsContainer);
  //           });
  //         })
  //         .catch(error => {
  //           console.error('Error loading prompts:', error);
  //           promptsDiv.innerHTML = '<div class="error">Error loading analysis prompts</div>';
  //         });
  //     </script>
  //   </body>
  //   </html>
  // `);
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start the server
app.listen(port, () => {
  console.log(`MCP Server running on port ${port}`);
});

// Error handling for uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});
