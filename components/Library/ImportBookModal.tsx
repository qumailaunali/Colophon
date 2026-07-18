"use client";

import styles from "./ImportBookModal.module.css";

interface ImportBookModalProps {
  onClose: () => void;
}

export function ImportBookModal({ onClose }: ImportBookModalProps) {
  const shadowLibraries = [
    {
      name: "Library Genesis (LibGen)",
      description: "Massive directory of scientific research articles, academic texts, and general books.",
      mirrors: [
        { label: "la (stable)", url: "https://libgen.la" },
        { label: "is", url: "https://libgen.is" },
        { label: "rs", url: "https://libgen.rs" },
        { label: "st", url: "https://libgen.st" },
        { label: "li (Asia)", url: "http://libgen.li" },
        { label: "gl", url: "https://libgen.gl" },
        { label: "bz", url: "https://libgen.bz" },
        { label: "vg", url: "https://libgen.vg" },
      ],
    },
    {
      name: "Z-Library",
      description: "One of the largest digital shadow libraries offering millions of downloadable books.",
      mirrors: [
        { label: "z-lib.id", url: "https://z-lib.id" },
        { label: "fm", url: "https://z-lib.fm" },
        { label: "ec", url: "https://z-library.ec" },
        { label: "gd", url: "https://z-lib.gd" },
        { label: "gl", url: "https://z-lib.gl" },
        { label: "1lib.sk", url: "https://1lib.sk" },
      ],
    },
    {
      name: "Anna's Archive",
      description: "Aggregates links across all major shadow libraries in a unified index.",
      mirrors: [
        { label: "pk", url: "https://annas-archive.pk" },
        { label: "gd", url: "https://annas-archive.gd" },
        { label: "gl", url: "https://annas-archive.gl" },
      ],
    },
    {
      name: "Sci-Hub",
      description: "Provides free access to millions of research papers and scientific articles.",
      mirrors: [
        { label: "se", url: "https://sci-hub.se" },
        { label: "ru", url: "https://sci-hub.ru" },
        { label: "st", url: "https://sci-hub.st" },
      ],
    },
  ];

  const legalLibraries = [
    { name: "Project Gutenberg", url: "https://www.gutenberg.org", desc: "70k+ public domain classics" },
    { name: "Standard Ebooks", url: "https://standardebooks.org", desc: "Beautifully formatted classics" },
    { name: "Open Library", url: "https://openlibrary.org", desc: "Internet Archive's catalog" },
    { name: "PDF Drive", url: "https://www.pdfdrive.com", desc: "Ebook search database" },
    { name: "ManyBooks", url: "https://manybooks.net", desc: "Free online books library" },
  ];

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Browse and Download Ebooks</h2>
          <button className={styles.closeButton} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body}>
          <div className={styles.instructions}>
            <h3>Instructions:</h3>
            <ol>
              <li>Click any mirror link below to browse for books on the external website.</li>
              <li>Download the book in <strong>.epub</strong> format to your device.</li>
              <li>Close this popup and click the yellow <strong>+ Add a book</strong> button to upload it here.</li>
            </ol>
          </div>

          <div className={styles.contentGrid}>
            <div className={styles.column}>
              <h3>Shadow Libraries & Mirrors</h3>
              <div className={styles.libraryList}>
                {shadowLibraries.map((lib, idx) => (
                  <div key={idx} className={styles.sourceCard}>
                    <div className={styles.sourceInfo}>
                      <h4>{lib.name}</h4>
                      <p>{lib.description}</p>
                    </div>
                    <div className={styles.mirrorGroup}>
                      {lib.mirrors.map((mirror, mIdx) => (
                        <a
                          key={mIdx}
                          href={mirror.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.mirrorLink}
                        >
                          {mirror.label}
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.column}>
              <h3>Legal & Public Domain</h3>
              <div className={styles.legalList}>
                {legalLibraries.map((lib, idx) => (
                  <a
                    key={idx}
                    href={lib.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.legalLink}
                  >
                    <div className={styles.legalInfo}>
                      <h4>{lib.name}</h4>
                      <p>{lib.desc}</p>
                    </div>
                    <span className={styles.arrowIcon}>↗</span>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
