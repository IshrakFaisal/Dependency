import { z } from "zod";

// Validate identifiers only. Registry URL segments are encoded server-side;
// identifiers are never interpreted as commands.
const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const numericIdentifier = "(?:0|[1-9]\\d*)";
const prereleaseIdentifier = "(?:0|[1-9]\\d*|\\d*[a-zA-Z-][a-zA-Z0-9-]*)";
const versionPattern = new RegExp(
  `^${numericIdentifier}\\.${numericIdentifier}\\.${numericIdentifier}(?:-${prereleaseIdentifier}(?:\\.${prereleaseIdentifier})*)?(?:\\+[a-zA-Z0-9-]+(?:\\.[a-zA-Z0-9-]+)*)?$`,
);

const packageVersionSchema = z
  .string()
  .trim()
  .min(1, "Enter a version.")
  .max(128, "Use a version shorter than 129 characters.")
  .regex(
    versionPattern,
    "Enter an exact version, such as 1.4.1 or 2.0.0-beta.1.",
  );

export const comparisonInputSchema = z
  .object({
    packageName: z
      .string()
      .trim()
      .min(1, "Enter an npm package name.")
      .max(214, "Package names must be 214 characters or fewer.")
      .regex(
        packageNamePattern,
        "Use a lowercase npm name, such as example-utils or @example/utils.",
      ),
    trustedVersion: packageVersionSchema,
    candidateVersion: packageVersionSchema,
  })
  .strict()
  .refine((value) => value.trustedVersion !== value.candidateVersion, {
    message: "Choose two different versions to compare.",
    path: ["candidateVersion"],
  });

export type ComparisonInput = z.infer<typeof comparisonInputSchema>;
