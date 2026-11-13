import express, { Request, Response } from 'express'; 
import cors from 'cors';
import { MongoClient, Db } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

const uri = process.env.MONGODB_URI as string;
const client = new MongoClient(uri);

let db: Db;

async function run() {
  try {
    await client.connect();
    db = client.db("BookNookDB");
    console.log("Connected to MongoDB successfully!");
  } catch (error) {
    console.error("MongoDB Connection Error:", error);
  }
}
run();


app.get("/", (req: Request, res: Response) => {
  res.send("BookNook Backend with TypeScript is running!");
});


app.post("/books", async (req: Request, res: Response) => {
  try {
    const book = req.body;
    const result = await db.collection("books").insertOne(book);
    res.status(201).json({ message: "Book added successfully", result });
  } catch (error) {
    res.status(500).json({ message: "Failed to add book" });
  }
});

app.get("/books", async (req: Request, res: Response) => {
  try {
    const books = await db.collection("books").find().toArray();
    res.status(200).json(books);
  } catch (error) {
    console.error("Error fetching books:", error);
    res.status(500).json({ message: "Failed to fetch books from database" });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});