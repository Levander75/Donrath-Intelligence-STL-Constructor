# Donrath Intelligence STL Constructor

Parametrischer 3D-Konstruktor für den 3D-Druck – im Donrath-Intelligence-Design, für Windows.

## Funktionen (v1.0)

| Bereich | Umfang |
|---|---|
| **Formen** | Quader (mit Eckenradius und verrundeter Oberkante), Zylinder, Rohr, Kegel, Kugel, Torus, Prisma, Text |
| **Boolesche Operationen** | Vereinen, Abziehen, Schnittmenge, Gruppieren – nicht-destruktiv, jederzeit wieder auflösbar |
| **Bearbeiten** | Verschieben, Drehen, Skalieren per Gizmo oder Zahlen, Raster (1 mm / 15°), Spiegeln, Duplizieren, Auf Bett legen, Zentrieren, Anordnen, Rückgängig/Wiederholen |
| **Vorlagen (parametrisch)** | TUBIQ Halo Handsender, Projektbox mit Deckel, Abstandshalter, Wandhalter |
| **Druck-Check** | Bauraum, Bettkontakt/schwebend, wasserdicht, getrennte Körper, Überhänge (rot markiert), dünne Wände, Volumen, Gewicht und Filamentlänge |
| **Ansicht** | Hochglanz-Darstellung, Standardansichten, Schnittansicht, Messen, Drahtgitter |
| **Dateien** | Import STL/OBJ/3MF · Export STL (binär) und 3MF (mit Farben) · Projektdatei `.dicp` |

Der Geometrie-Kern ist [Manifold](https://github.com/elalish/manifold): Alle Ergebnisse sind garantiert wasserdichte Netze.

## Entwickeln

```bash
npm install
npm start          # baut die Oberfläche und startet die App
npm test           # prüft alle Formen und Vorlagen
```

## Windows-Paket bauen

```bash
npm run dist:zip   # portable ZIP (läuft auch unter Linux)
npm run dist       # Installer + ZIP (unter Windows)
```

Der Installer wird automatisch über **GitHub Actions** gebaut: *Actions → Windows-Build → Run workflow* oder ein Tag `v1.0.0` pushen. Die Dateien liegen danach unter *Artifacts*.

## Aufbau

```
src/main/        Hauptprozess (Fenster, Dateidialoge) und Preload-Brücke
src/renderer/    Oberfläche
  js/app.js        Anwendung: Dokument, Verlauf, Panels, Menüs, Tastenkürzel
  js/geometry.js   Geometrie-Kern (Manifold): Grundformen, Booleans, Auswertung mit Cache
  js/templates.js  Parametrische Vorlagen
  js/viewer.js     3D-Ansicht (three.js): Bett, Gizmo, Schnitt, Messen, Markierungen
  js/printcheck.js Druck-Check
  js/io.js         STL/OBJ/3MF-Import, STL/3MF-Export, Projektdatei
test/            Geometrie-Tests
```

## Tastenkürzel (Auswahl)

`W` Verschieben · `E` Drehen · `R` Skalieren · `G` Raster · `B` Auf Bett legen · `C` Zentrieren · `M` Messen · `X` Schnitt · `F` Einpassen · `F5` Druck-Check · `Strg+U` Vereinen · `Strg+M` Abziehen · `Strg+D` Duplizieren · `Entf` Löschen · `Strg+Z/Y` Rückgängig/Wiederholen · Pfeiltasten/Bild↑↓ verschieben um 1 mm (Umschalt: 10 mm)

---
© Donrath Intelligence · Privates Projekt
