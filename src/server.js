require("dotenv").config();
const express = require("express");
const db = require("./db");

const app = express();
app.use(express.json());

// Health check
app.get("/health", async (req, res) => {
  const result = await db.query("SELECT NOW()");
  res.json({
    status: "ok",
    time: result.rows[0].now,
  });
});

app.listen(process.env.PORT, () => {
  console.log(`Server running on http://localhost:${process.env.PORT}`);
});
