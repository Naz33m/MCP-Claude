# MCP-Claude

### Installation
Clone the repository (if applicable):

```bash
git clone <your-repository-url>
cd <your-project-directory>
```

Install the required npm packages:

```bash
npm install express pg body-parser cors morgan dotenv
```

### Configuration
This application relies on environment variables for configuration, particularly for database connection details.

Create a .env file in the root directory of your project.

Populate the .env file with your PostgreSQL database credentials and server port, using the following format:

```
PORT=3000
DB_HOST=your-database-host
DB_PORT=5432
DB_NAME=your-database-name
DB_USER=your-username
DB_PASSWORD=your-password
DB_SSL=false
```
