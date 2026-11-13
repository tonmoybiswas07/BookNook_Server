
import express, {
  Request,
  Response,
  NextFunction,
} from "express";
import cors from "cors";
import dotenv from "dotenv";
import {
  MongoClient,
  Db,
  ObjectId,
  ClientSession,
} from "mongodb";
import {
  createRemoteJWKSet,
  jwtVerify,
} from "jose";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8000);

const mongoURI = process.env.MONGODB_URI;
const authURL = process.env.BETTER_AUTH_URL;
const jwtIssuer = process.env.JWT_ISSUER;
const jwtAudience = process.env.JWT_AUDIENCE;

if (!mongoURI || !authURL || !jwtIssuer || !jwtAudience) {
  throw new Error("Required environment variables are missing");
}

const client = new MongoClient(mongoURI);
let db: Db;



app.use(
  cors({
    origin: `${process.env.CLIENT_URL}`,
    credentials: true,
    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
    ],
  })
);


app.use(express.json({ limit: "1mb" }));


const JWKS = createRemoteJWKSet(
  new URL("/api/auth/jwks", authURL)
);

interface AuthUser {
  id: string;
  email: string;
}

interface AuthRequest extends Request {
  authUser?: AuthUser;
}

const verifyJWT = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization?.startsWith("Bearer ")) {
      res.status(401).json({
        message: "Unauthorized: JWT token missing",
      });
      return;
    }

    const token = authorization.slice(7).trim();

    if (!token) {
      res.status(401).json({
        message: "JWT token missing",
      });
      return;
    }

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: jwtIssuer,
      audience: jwtAudience,
      algorithms: ["EdDSA", "ES256", "RS256"],
    });

    if (
      typeof payload.sub !== "string" ||
      !payload.sub ||
      typeof payload.email !== "string" ||
      !payload.email.trim()
    ) {
      res.status(401).json({
        message: "Invalid JWT user information",
      });
      return;
    }

    req.authUser = {
      id: payload.sub,
      email: payload.email.trim().toLowerCase(),
    };

    next();
  } catch (error) {
    console.error("JWT Error:", error);

    res.status(401).json({
      message: "Invalid or expired JWT token",
    });
  }
};



const validId = (id: unknown): id is string =>
  typeof id === "string" && ObjectId.isValid(id);

const validBookData = (data: Record<string, unknown>) => {
  const fields = [
    "title",
    "author",
    "category",
    "image",
    "description",
  ];

  return (
    fields.every(
      (field) =>
        typeof data[field] === "string" &&
        (data[field] as string).trim().length > 0
    ) &&
    Number.isInteger(data.totalCopies) &&
    (data.totalCopies as number) >= 0
  );
};

const bookFields = (data: Record<string, unknown>) => ({
  title: (data.title as string).trim(),
  author: (data.author as string).trim(),
  category: (data.category as string).trim(),
  image: (data.image as string).trim(),
  description: (data.description as string).trim(),
  totalCopies: data.totalCopies as number,
});

const getEmail = (req: AuthRequest) => req.authUser!.email;



app.get("/", (_req: Request, res: Response) => {
  res.json({
    message: "BookNook Backend is running!",
    jwt: "Enabled",
  });
});



app.get("/books", async (_req: Request, res: Response) => {
  try {
    const books = await db
      .collection("books")
      .find()
      .toArray();

    return res.status(200).json(books);
  } catch (error) {
    console.error("Get Books Error:", error);
    return res.status(500).json({
      message: "Failed to fetch books",
    });
  }
});



app.get("/books/latest", async (_req: Request, res: Response) => {
  try {
    const books = await db
      .collection("books")
      .find()
      .sort({ addedDate: -1 })
      .limit(6)
      .toArray();

    return res.status(200).json(books);
  } catch (error) {
    console.error("Latest Books Error:", error);
    return res.status(500).json({
      message: "Failed to fetch latest books",
    });
  }
});



app.get("/books/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id;

    if (!validId(id)) {
      return res.status(400).json({
        message: "Invalid book ID",
      });
    }

    const book = await db.collection("books").findOne({
      _id: new ObjectId(id),
    });

    if (!book) {
      return res.status(404).json({
        message: "Book not found",
      });
    }

    return res.status(200).json(book);
  } catch (error) {
    console.error("Book Details Error:", error);
    return res.status(500).json({
      message: "Failed to fetch book details",
    });
  }
});



app.post(
  "/books",
  verifyJWT,
  async (req: AuthRequest, res: Response) => {
    try {
      const data = req.body;

      if (!data || !validBookData(data)) {
        return res.status(400).json({
          message: "Invalid book information",
        });
      }

      const book = {
        ...bookFields(data),
        userName:
          typeof data.userName === "string"
            ? data.userName.trim()
            : "",
        userEmail: getEmail(req),
        addedDate: new Date().toISOString(),
      };

      const result = await db
        .collection("books")
        .insertOne(book);

      return res.status(201).json({
        message: "Book added successfully",
        result,
      });
    } catch (error) {
      console.error("Add Book Error:", error);
      return res.status(500).json({
        message: "Failed to add book",
      });
    }
  }
);



app.get(
  "/my-books",
  verifyJWT,
  async (req: AuthRequest, res: Response) => {
    try {
      const books = await db
        .collection("books")
        .find({ userEmail: getEmail(req) })
        .sort({ addedDate: -1 })
        .toArray();

      return res.status(200).json(books);
    } catch (error) {
      console.error("My Books Error:", error);
      return res.status(500).json({
        message: "Failed to fetch your books",
      });
    }
  }
);




app.patch(
  "/books/:id",
  verifyJWT,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id;

      if (!validId(id)) {
        return res.status(400).json({
          message: "Invalid book ID",
        });
      }

      if (!req.body || !validBookData(req.body)) {
        return res.status(400).json({
          message: "Invalid book information",
        });
      }

      const result = await db
        .collection("books")
        .updateOne(
          {
            _id: new ObjectId(id),
            userEmail: getEmail(req),
          },
          {
            $set: bookFields(req.body),
          }
        );

      if (result.matchedCount === 0) {
        return res.status(404).json({
          message: "Book not found or access denied",
        });
      }

      return res.status(200).json({
        message: "Book updated successfully",
      });
    } catch (error) {
      console.error("Update Book Error:", error);
      return res.status(500).json({
        message: "Failed to update book",
      });
    }
  }
);



app.delete(
  "/books/:id",
  verifyJWT,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id;

      if (!validId(id)) {
        return res.status(400).json({
          message: "Invalid book ID",
        });
      }

      const activeBorrow = await db
        .collection("borrows")
        .findOne({ bookId: id });

      if (activeBorrow) {
        return res.status(409).json({
          message: "Cannot delete a book with active borrowings",
        });
      }

      const result = await db
        .collection("books")
        .deleteOne({
          _id: new ObjectId(id),
          userEmail: getEmail(req),
        });

      if (result.deletedCount === 0) {
        return res.status(404).json({
          message: "Book not found or access denied",
        });
      }

      return res.status(200).json({
        message: "Book deleted successfully",
      });
    } catch (error) {
      console.error("Delete Book Error:", error);
      return res.status(500).json({
        message: "Failed to delete book",
      });
    }
  }
);


app.post(
  "/borrows",
  verifyJWT,
  async (req: AuthRequest, res: Response) => {
    const session = client.startSession();

    try {
      const { bookId } = req.body ?? {};
      const email = getEmail(req);

      if (!validId(bookId)) {
        return res.status(400).json({
          message: "Valid book ID is required",
        });
      }

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

        borrowResult = await borrowsCollection.insertOne(
          {
            bookId,
            bookTitle: book.title,
            bookImage: book.image,
            userEmail: email,
            borrowDate: borrowDate.toISOString(),
            returnDate: returnDate.toISOString(),
          },
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
  }
);



app.get(
  "/borrows",
  verifyJWT,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await db
        .collection("borrows")
        .find({
          userEmail: getEmail(req),
        })
        .sort({ borrowDate: -1 })
        .toArray();

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get Borrows Error:", error);
      return res.status(500).json({
        message: "Failed to fetch borrowed books",
      });
    }
  }
);



async function finishBorrow(
  id: string,
  email: string,
  session: ClientSession
) {
  const borrow = await db
    .collection("borrows")
    .findOneAndDelete(
      {
        _id: new ObjectId(id),
        userEmail: email,
      },
      { session }
    );

  if (!borrow) {
    throw new Error("BORROW_NOT_FOUND");
  }

  if (!validId(borrow.bookId)) {
    throw new Error("BOOK_NOT_FOUND");
  }

  const result = await db
    .collection("books")
    .updateOne(
      {
        _id: new ObjectId(borrow.bookId),
      },
      {
        $inc: { totalCopies: 1 },
      },
      { session }
    );

  if (result.matchedCount === 0) {
    throw new Error("BOOK_NOT_FOUND");
  }
}


app.delete(
  "/borrows/:id",
  verifyJWT,
  async (req: AuthRequest, res: Response) => {
    const session = client.startSession();

    try {
      const id = req.params.id;

      if (!validId(id)) {
        return res.status(400).json({
          message: "Invalid borrow ID",
        });
      }

      await session.withTransaction(async () => {
        await finishBorrow(id, getEmail(req), session);
      });

      return res.status(200).json({
        message: "Borrow removed and book stock restored",
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "BORROW_NOT_FOUND"
      ) {
        return res.status(404).json({
          message: "Borrow record not found",
        });
      }

      console.error("Delete Borrow Error:", error);
      return res.status(500).json({
        message: "Failed to delete borrow",
      });
    } finally {
      await session.endSession();
    }
  }
);



app.patch(
  "/borrows/:id/return",
  verifyJWT,
  async (req: AuthRequest, res: Response) => {
    const session = client.startSession();

    try {
      const id = req.params.id;

      if (!validId(id)) {
        return res.status(400).json({
          message: "Invalid borrow ID",
        });
      }

      await session.withTransaction(async () => {
        await finishBorrow(id, getEmail(req), session);
      });

      return res.status(200).json({
        message: "Book returned successfully",
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "BORROW_NOT_FOUND"
      ) {
        return res.status(404).json({
          message: "Borrow record not found",
        });
      }

      console.error("Return Book Error:", error);
      return res.status(500).json({
        message: "Failed to return book",
      });
    } finally {
      await session.endSession();
    }
  }
);



async function startServer() {
  try {
    await client.connect();

    db = client.db("BookNookDB");

    await db.collection("borrows").createIndex(
      { bookId: 1, userEmail: 1 },
      { unique: true }
    );

    console.log("MongoDB connected successfully!");

    app.listen(port, () => {
      console.log(
        `BookNook server running on ${port}`
      );
    });
  } catch (error) {
    console.error("Server startup error:", error);
    process.exit(1);
  }
}

startServer();
