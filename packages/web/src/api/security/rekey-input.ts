import { z } from "zod";
import { ciphertextInput, ivInput, saltInput } from "./inputs";
export const rekeyInput = z.object({
  authorization: z.string().uuid().optional(),
  writeKey: z
    .object({
      privateCiphertext: ciphertextInput,
      privateIv: ivInput,
      expectedVersion: z.number().int().positive(),
    })
    .optional(),
  expectedGeneration: z.number().int().min(1),
  kdfSalt: saltInput,
  kdfIterations: z.number().int().min(100_000).max(2_000_000),
  verifierCiphertext: ciphertextInput,
  verifierIv: ivInput,
  records: z
    .array(
      z.object({
        id: z.string().max(200),
        ciphertext: ciphertextInput,
        iv: ivInput,
        baseSeq: z.number().int().min(0),
      }),
    )
    .max(5000),
});
