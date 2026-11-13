import express, { Request, Response } from 'express';
import cors from 'cors';
import { MongoClient, Db, ObjectId } from "mongodb";
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
app.get("/books/latest", async (req, res) => {
  try {
    const books = await db.collection("books")
      .find()
      .sort({ addedDate: -1 })
      .limit(6)
      .toArray();
    res.send(books);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch latest books" });
  }
});

app.get("/books/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id as string)) {
      return res.status(400).json({
        message: "Invalid book ID",
      });
    }

    const book = await db.collection("books").findOne({
      _id: new ObjectId(id as string),
    });

    if (!book) {
      return res.status(404).json({
        message: "Book not found",
      });
    }

    res.status(200).json(book);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch book details",
    });
  }
});

app.get("/my-books",

  async (req: Request, res: Response) => {
    try {
      const email = req.headers["x-user-email"] as string;

      if (!email) {
        return res.status(400).json({
          message: "User email is required",
        });
      }

      const books = await db
        .collection("books")
        .find({ userEmail: email })
        .sort({ addedDate: -1 })
        .toArray();

      res.status(200).json(books);
    } catch (error) {
      console.error("My Books Error:", error);

      res.status(500).json({
        message: "Failed to fetch your books",
      });
    }
  }
);

app.patch("/books/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const email = req.headers["x-user-email"];

    if (typeof id !== "string" || !ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid book ID",
      });
    }

    if (typeof email !== "string" || !email) {
      return res.status(401).json({
        message: "User email is required",
      });
    }

    const {
      title,
      author,
      category,
      image,
      description,
      totalCopies,
    } = req.body;

    if (
      [title, author, category, image, description].some(
        (value) => typeof value !== "string" || !value.trim()
      ) ||
      !Number.isInteger(totalCopies) ||
      totalCopies < 0
    ) {
      return res.status(400).json({
        message: "Invalid book information",
      });
    }

    const result = await db.collection("books").updateOne(
      {
        _id: new ObjectId(id),
        userEmail: email,
      },
      {
        $set: {
          title: title.trim(),
          author: author.trim(),
          category: category.trim(),
          image: image.trim(),
          description: description.trim(),
          totalCopies,
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        message: "Book not found or unauthorized",
      });
    }

    return res.status(200).json({
      message: "Book updated successfully",
    });
  } catch (error) {
    console.error("Update Error:", error);

    return res.status(500).json({
      message: "Failed to update book",
    });
  }
});

app.delete("/books/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const email = req.headers["x-user-email"];

    if (typeof id !== "string" || !ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid book ID",
      });
    }

    if (typeof email !== "string" || !email) {
      return res.status(401).json({
        message: "User email is required",
      });
    }

    const result = await db.collection("books").deleteOne({
      _id: new ObjectId(id),
      userEmail: email,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        message: "Book not found or unauthorized",
      });
    }

    return res.status(200).json({
      message: "Book deleted successfully",
    });
  } catch (error) {
    console.error("Delete Error:", error);

    return res.status(500).json({
      message: "Failed to delete book",
    });
  }
});

app.post("/borrows", async (req: Request, res: Response) => {
  const session = client.startSession();

  try {
    const { bookId, userEmail } = req.body;

    if (
      typeof bookId !== "string" ||
      !ObjectId.isValid(bookId) ||
      typeof userEmail !== "string" ||
      !userEmail.trim()
    ) {
      return res.status(400).json({
        message: "Valid book ID and user email are required",
      });
    }

    const email = userEmail.trim().toLowerCase();

    const booksCollection = db.collection("books");
    const borrowsCollection = db.collection("borrows");

    let borrowResult;

    await session.withTransaction(async () => {
      const alreadyBorrowed = await borrowsCollection.findOne(
        {
          bookId,
          userEmail: email,
        },
        { session }
      );

      if (alreadyBorrowed) {
        throw new Error("ALREADY_BORROWED");
      }

      const book = await booksCollection.findOneAndUpdate(
        {
          _id: new ObjectId(bookId),
          totalCopies: { $gt: 0 },
        },
        {
          $inc: { totalCopies: -1 },
        },
        {
          returnDocument: "before",
          session,
        }
      );

      if (!book) {
        throw new Error("BOOK_NOT_AVAILABLE");
      }

      const borrowDate = new Date();

      const returnDate = new Date(borrowDate);
      returnDate.setDate(returnDate.getDate() + 7);

      const borrowData = {
        bookId,
        bookTitle: book.title,
        bookImage: book.image,
        userEmail: email,
        borrowDate: borrowDate.toISOString(),
        returnDate: returnDate.toISOString(),
      };

      borrowResult = await borrowsCollection.insertOne(
        borrowData,
        { session }
      );
    });

    return res.status(201).json({
      message: "Book borrowed successfully",
      result: borrowResult,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "ALREADY_BORROWED"
    ) {
      return res.status(409).json({
        message: "You have already borrowed this book",
      });
    }

    if (
      error instanceof Error &&
      error.message === "BOOK_NOT_AVAILABLE"
    ) {
      return res.status(409).json({
        message: "Book is not available",
      });
    }

    console.error("Borrow Error:", error);

    return res.status(500).json({
      message: "Failed to borrow book",
    });
  } finally {
    await session.endSession();
  }
});




app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});