# Donrath Intelligence STL Constructor

Parametrischer 3D-Konstruktor für den 3D-Druck – im Donrath-Intelligence-Design, für Windows.

## Funktionen (v1.1)

| Bereich | Umfang |
|---|---|
| **Formen** | Quader (Eckenradius, verrundete Oberkante), Zylinder, Rohr, Kegel, Kugel, Halbkugel, Torus, Prisma, Pyramide, Keil, Langloch, Stern, Gewindestange, Text |
| **Boolesche Operationen** | Vereinen, Abziehen, Schnittmenge, Hülle, Gruppieren – nicht-destruktiv, jederzeit auflösbar |
| **Modifikatoren** | Aushöhlen (Wandstärke, oben/unten offen), Abschneiden, Teilen, Muster (Reihe, Raster, Kreis) – zerstörungsfrei, Werte jederzeit änderbar |
| **Bearbeiten** | Gizmo oder Zahlen, Raster, Spiegeln, Drehen 90°, Maße setzen (mm oder %), Position/Drehung/Skalierung zurücksetzen, Ausrichten und Verteilen, Mit Fläche aufs Bett legen, Kopieren/Ausschneiden/Einfügen, Ausblenden/Isolieren, Rückgängig/Wiederholen |
| **Rechtsklick-Menü** | Auf Objekten (3D-Ansicht und Szenenbaum) und auf leerer Fläche – alle Befehle samt Untermenüs, Farbpalette und Export einzelner Objekte |
| **Vorlagen (parametrisch)** | TUBIQ Halo Handsender, Projektbox mit Deckel, Abstandshalter, Wandhalter, Zahnrad, Namens-/Türschild, Kabelclip, Drehknopf, Handy-/Tabletständer |
| **Druck-Check** | Bauraum, Bettkontakt/schwebend, wasserdicht, getrennte Körper, Überhänge, dünne Wände, Volumen, Gewicht, Filamentlänge; 12 Materialien, Druckerprofile (Bambu, Prusa, Creality, Elegoo, Voron, Qidi, Harzdrucker) |
| **Ansicht** | Hochglanz-Darstellung, Standardansichten, Schnittansicht, Messen, Drahtgitter, Bild der Ansicht als PNG |
| **Dateien** | Import STL, OBJ, 3MF, PLY, AMF, OFF (auch per Ziehen & Ablegen) · Export STL (binär/ASCII), 3MF, OBJ, PLY (farbig), AMF, OFF, X3D · Projektdatei `.dicp` (Doppelklick öffnet im laufenden Programm) · Rückfrage beim Schließen |

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

Der Installer wird automatisch über **GitHub Actions** gebaut: *Actions → Windows-Build → Run workflow* oder ein Tag `v1.1.0` pushen. Die Dateien liegen danach unter *Artifacts*.

## Aufbau

```
src/main/        Hauptprozess (Fenster, Dateidialoge) und Preload-Brücke
src/renderer/    Oberfläche
  js/app.js        Anwendung: Dokument, Verlauf, Panels, Menüs, Tastenkürzel
  js/geometry.js   Geometrie-Kern (Manifold): Grundformen, Booleans, Auswertung mit Cache
  js/templates.js  Parametrische Vorlagen
  js/viewer.js     3D-Ansicht (three.js): Bett, Gizmo, Schnitt, Messen, Markierungen
  js/printcheck.js Druck-Check
  js/io.js         Import/Export aller Formate, Projektdatei
test/            Geometrie- und Format-Tests
```

## Tastenkürzel (Auswahl)

`W` Verschieben · `E` Drehen · `R` Skalieren · `G` Raster · `B` Auf Bett legen · `C` Zentrieren · `M` Messen · `X` Schnitt · `F` Einpassen · `F5` Druck-Check · `Strg+U` Vereinen · `Strg+M` Abziehen · `Strg+D` Duplizieren · `Strg+C/X/V` Kopieren/Ausschneiden/Einfügen · `Strg+L` Maße setzen · `Strg+0` Position auf 0 · `F2` Umbenennen · `H` Ausblenden · `Strg+Umschalt+E` Exportieren als … · `Entf` Löschen · `Strg+Z/Y` Rückgängig/Wiederholen · Pfeiltasten/Bild↑↓ verschieben um 1 mm (Umschalt: 10 mm)

---
© Donrath Intelligence · Privates Projekt
