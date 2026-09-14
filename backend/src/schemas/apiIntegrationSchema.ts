import { z } from "zod";

export const apiIntegrationSchema = z.object({
  name: z.string().trim().min(1, "API name is required").max(100),
  baseUrl: z.string().trim().min(1, "Base URL is required").url("Enter a valid URL"),
  apiKey: z.string().trim().min(1, "API key is required").max(1000),
});

export type ApiIntegrationForm = z.infer<typeof apiIntegrationSchema>;
