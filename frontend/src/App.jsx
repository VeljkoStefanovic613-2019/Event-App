import { useEffect, useState } from "react";
import axios from "axios";
import imageCompression from "browser-image-compression";
import { FaDownload, FaCloudUploadAlt } from "react-icons/fa";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000";

export default function App() {
  const [files, setFiles] = useState([]);
  const [gallery, setGallery] = useState([]);
  const [progress, setProgress] = useState({});
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const authToken = localStorage.getItem("auth_token") || "";

  useEffect(() => {
    fetchFiles();
    const interval = setInterval(fetchFiles, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchFiles = async () => {
    try {
      const res = await axios.get(`${API}/files`);
      setGallery(res.data);
      setError(null);
    } catch (err) {
      console.error("Greška pri učitavanju:", err);
      setError("Greška pri učitavanju fajlova.");
    } finally {
      setLoading(false);
    }
  };

  const upload = async () => {
    if (files.length === 0) return;
    setUploading(true);

    for (let file of files) {
      let uploadFile = file;

      if (file.type.startsWith("image")) {
        try {
          const options = { maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true };
          uploadFile = await imageCompression(file, options);
        } catch (err) {
          console.error("Kompresija neuspešna za:", file.name);
        }
      }

      try {
        const { data } = await axios.post(
          `${API}/upload-url`,
          {
            fileName: file.name,
            fileType: uploadFile.type,
            fileSize: uploadFile.size,
          },
          {
            headers: { Authorization: `Bearer ${authToken}` },
          }
        );

        await axios.put(data.url, uploadFile, {
          headers: { "Content-Type": uploadFile.type },
          onUploadProgress: (e) => {
            const percent = Math.round((e.loaded * 100) / e.total);
            setProgress((prev) => ({ ...prev, [file.name]: percent }));
          },
        });
      } catch (err) {
        console.error("Upload failed for:", file.name);
      }
    }

    setUploading(false);
    setFiles([]);
    setTimeout(() => setProgress({}), 3000);
    fetchFiles();
  };

  return (
    <div className="container">
      <header className="header">
        <h1>EVENT<span>GALLERY</span></h1>

        <div className="actions">
          <label className="custom-upload">
            <FaCloudUploadAlt />{" "}
            {files.length > 0 ? `${files.length} odabrano` : "Izaberi fajlove"}
            <input
              type="file"
              multiple
              accept="image/*,video/*"
              onChange={(e) => setFiles(Array.from(e.target.files))}
            />
          </label>

          <button
            className="btn-primary"
            onClick={upload}
            disabled={uploading || files.length === 0}
          >
            {uploading ? "Slanje..." : "Upload"}
          </button>

          <a
            href={`${API}/download-all`}
            className="btn-download"
            title="Preuzmi sve (ZIP)"
          >
            <FaDownload />
          </a>
        </div>
      </header>

      {error && <p className="error-msg">{error}</p>}

      {Object.keys(progress).length > 0 && (
        <div className="upload-status">
          {Object.entries(progress).map(([name, value]) => (
            <div key={name} className="progress-item">
              <div className="progress-info">
                <span>{name.length > 20 ? name.substring(0, 20) + "..." : name}</span>
                <span>{value}%</span>
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${value}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <p className="loading-msg">Učitavanje...</p>
      ) : gallery.length === 0 ? (
        <p className="empty-msg">Nema fajlova. Budite prvi koji će upload-ovati!</p>
      ) : (
        <main className="grid">
          {gallery.map((file, i) => (
            <div key={file.key || i} className="card">
              {file.key.match(/\.(jpeg|jpg|gif|png|webp)$/i) ? (
                <img src={file.url} alt={`Upload ${i}`} loading="lazy" />
              ) : (
                <video src={file.url} controls playsInline />
              )}

              <a
                href={file.downloadUrl}
                className="single-download-btn"
                title="Preuzmi ovaj fajl"
                download
              >
                <FaDownload />
              </a>
            </div>
          ))}
        </main>
      )}
    </div>
  );
}
