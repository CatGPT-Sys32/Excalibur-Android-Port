export type ImportFile = {
  name: string;
  mimeType: string;
  blob: Blob;
  size: number;
};

export type ImportPlan = {
  scenes: ImportFile[];
  libraries: ImportFile[];
  images: ImportFile[];
  unsupported: ImportFile[];
  oversized: ImportFile[];
};
