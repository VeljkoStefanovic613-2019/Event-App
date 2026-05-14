import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import archiver from "archiver";
import rateLimit from "express-rate-limit";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

dotenv.config();

// ─── Validacija env promenljivih ───
const required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY", "R2_SECRET_KEY", "R2_BUCKET", "AUTH_TOKEN"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Nedostaje ${key} u .env`);
    process.exit(1);
  }
}

const app = express();

// ─── Middleware ───
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
}));
app.use(express.json());

// ─── Rate limiting ───
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: "Previše zahteva. Pokušajte ponovo za 15 minuta." },
}));

// ─── Auth middleware ───
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== process.env.AUTH_TOKEN) {
    return res.status(401).json({ error: "Neautorizovan pristup." });
  }
  next();
}

// ─── R2 Config ───
const EVENT_ID = process.env.EVENT_ID || "event-123";

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY,
  },
});

// ─── Helper: sanitizuj ime fajla ───
function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

// ─── Helper: list all objects sa paginacijom ───
async function listAllObjects(prefix) {
  let allContents = [];
  let continuationToken;

  do {
    const data = await s3.send(
      new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    allContents.push(...(data.Contents || []));
    continuationToken = data.NextContinuationToken;
  } while (continuationToken);

  return allContents;
}

// ─── 1. PRESIGNED URL ZA UPLOAD ───
app.post("/upload-url", requireAuth, async (req, res) => {
  try {
    const { fileName, fileType, fileSize } = req.body;

    if (!fileName || !fileType) {
      return res.status(400).json({ error: "fileName i fileType su obavezni." });
    }

    if (fileSize && fileSize > 500 * 1024 * 1024) {
      return res.status(400).json({ error: "Fajl je prevelik. Maksimum je 500MB." });
    }

    const safeName = sanitizeFileName(fileName);
    const key = `${EVENT_ID}/${Date.now()}-${safeName}`;

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      ContentType: fileType,
    });

    const url = await getSignedUrl(s3, command, { expiresIn: 3600 });

    res.json({ url, key });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Greška pri generisanju linka." });
  }
});

// ─── 2. LISTANJE FAJLOVA ───
app.get("/files", async (req, res) => {
  try {
    const allContents = await listAllObjects(EVENT_ID);

    const files = await Promise.all(
      allContents
        .sort((a, b) => b.LastModified - a.LastModified)
        .map(async (f) => {
          const fileName = f.Key.split("/").pop();

          // URL za PRIKAZ (inline)
          const viewCommand = new GetObjectCommand({
            Bucket: process.env.R2_BUCKET,
            Key: f.Key,
          });
          const viewUrl = await getSignedUrl(s3, viewCommand, { expiresIn: 3600 });

          // URL za DOWNLOAD (attachment)
          const downloadCommand = new GetObjectCommand({
            Bucket: process.env.R2_BUCKET,
            Key: f.Key,
            ResponseContentDisposition: `attachment; filename="${fileName}"`,
          });
          const downloadUrl = await getSignedUrl(s3, downloadCommand, { expiresIn: 3600 });

          return {
            key: f.Key,
            url: viewUrl,
            downloadUrl,
            size: f.Size,
            lastModified: f.LastModified,
          };
        })
    );

    res.json(files);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Greška pri listanju fajlova." });
  }
});

// ─── 3. DOWNLOAD SVIH FAJLOVA KAO ZIP ───
app.get("/download-all", async (req, res) => {
  try {
    const allContents = await listAllObjects(EVENT_ID);

    if (allContents.length === 0) {
      return res.status(404).json({ error: "Nema fajlova za preuzimanje." });
    }

    const archive = archiver("zip", { zlib: { level: 5 } });
    res.attachment(`${EVENT_ID}-gallery.zip`);
    archive.pipe(res);

    for (const file of allContents) {
      const response = await s3.send(
        new GetObjectCommand({
          Bucket: process.env.R2_BUCKET,
          Key: file.Key,
        })
      );
      const fileName = file.Key.split("/").pop();
      archive.append(response.Body, { name: fileName });
    }

    archive.finalize();
  } catch (err) {
    console.error("ZIP Error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Greška pri kreiranju arhive." });
    }
  }
});

// ─── Health check ───
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server spreman na portu ${PORT}`);
});
