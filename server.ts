import "dotenv/config";
import express, { type Request, type Response } from "express";
import path from "path";
import fs from "fs";
import { GoogleGenAI, Type } from "@google/genai";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "50mb" }));

function getGeminiClient() {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    throw Object.assign(
      new Error("Falta configurar GEMINI_API_KEY en el servidor (Settings > Secrets)."),
      { status: 500 }
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function normalizeGeminiError(err: unknown): { status: number; message: string } {
  const anyErr = err as { status?: number; code?: number; message?: string };
  const rawMsg = String(anyErr?.message || "Error al conectar con Gemini.");
  const status = Number(anyErr?.status || anyErr?.code || 500);

  if (status === 403 || rawMsg.includes("PERMISSION_DENIED") || rawMsg.includes("API_KEY_INVALID")) {
    return {
      status: 403,
      message: "La clave de Gemini no es válida o no tiene permisos. Revisa GEMINI_API_KEY en Settings > Secrets.",
    };
  }
  if (status === 429 || rawMsg.includes("RESOURCE_EXHAUSTED")) {
    return {
      status: 429,
      message: "Se ha superado la cuota de la API de Gemini. Revisa tu plan o límites en Settings > Secrets.",
    };
  }
  return {
    status: status >= 400 && status < 600 ? status : 500,
    message: rawMsg,
  };
}

app.post("/api/gemini/scan-invoice", async (req: Request, res: Response) => {
  try {
    const { imageBase64, mimeType, pages } = req.body ?? {};
    const rawPages: Array<{ imageBase64?: unknown; mimeType?: unknown }> =
      Array.isArray(pages) && pages.length > 0
        ? pages.slice(0, 10)
        : [{ imageBase64, mimeType }];

    const imageParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
    for (const pg of rawPages) {
      if (typeof pg?.imageBase64 !== "string" || !pg.imageBase64.trim()) continue;
      const cleanB64 = pg.imageBase64.includes(",")
        ? pg.imageBase64.split(",")[1]?.trim() || ""
        : pg.imageBase64.trim();
      if (!cleanB64) continue;
      const cleanMime =
        typeof pg.mimeType === "string" && /^image\/[a-zA-Z0-9.+-]+$/.test(pg.mimeType.trim())
          ? pg.mimeType.trim()
          : "image/jpeg";
      imageParts.push({
        inlineData: {
          mimeType: cleanMime,
          data: cleanB64,
        },
      });
    }

    if (imageParts.length === 0) {
      res.status(400).json({ error: "No se recibió ninguna imagen válida de la factura." });
      return;
    }

    const ai = getGeminiClient();

    const prompt =
      "Extrae los datos de esta factura de proveedor española" +
      (imageParts.length > 1 ? ` (documento de ${imageParts.length} páginas: combina todas las líneas de artículos de todas las páginas en orden sin duplicar la cabecera)` : "") +
      " y devuelve ÚNICAMENTE un JSON válido siguiendo el esquema. " +
      "Usa formato YYYY-MM-DD para la fecha y valores numéricos en precios, cantidades e impuestos (tipoIVA por defecto 21 y recargoeEquivalencia por defecto 5.2 si aplica).";

    const response = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: {
        parts: [
          ...imageParts,
          { text: prompt },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            proveedor: {
              type: Type.OBJECT,
              properties: {
                nombre: { type: Type.STRING },
                cif: { type: Type.STRING },
              },
            },
            numeroFactura: { type: Type.STRING },
            fecha: { type: Type.STRING },
            articulos: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  referencia: { type: Type.STRING },
                  descripcion: { type: Type.STRING },
                  cantidad: { type: Type.NUMBER },
                  precioUnitario: { type: Type.NUMBER },
                  tipoIVA: { type: Type.NUMBER },
                  recargoeEquivalencia: { type: Type.NUMBER },
                  talla: { type: Type.STRING },
                  color: { type: Type.STRING },
                },
              },
            },
            subtotal: { type: Type.NUMBER },
            totalIVA: { type: Type.NUMBER },
            totalRE: { type: Type.NUMBER },
            total: { type: Type.NUMBER },
          },
        },
      },
    });

    const rawText = (response.text ?? "").trim();
    if (!rawText) {
      res.status(502).json({ error: "Gemini no devolvió contenido legible para esta factura." });
      return;
    }

    const cleanedJson = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(cleanedJson);
    res.json(parsed);
  } catch (err) {
    const normalized = normalizeGeminiError(err);
    res.status(normalized.status).json({ error: normalized.message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("*", (req: Request, res: Response) => {
      if (req.path.startsWith("/api/")) {
        res.status(404).json({ error: "Ruta de API no encontrada" });
        return;
      }
      const indexFile = path.join(distDir, "index.html");
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send("Not found");
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`babyluc server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
