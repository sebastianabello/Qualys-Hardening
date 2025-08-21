export type Artifact = {
  name: string;
  size: number;          // bytes
  download_url: string;
};

export type Counts = {
  t1_normal?: number;
  t1_ajustada?: number;
  t2_normal?: number;
  t2_ajustada?: number;
  [k: string]: number | undefined;
};

export type ProcessRun = {
  run_id: string;
  source_files: string[]; // nombres subidos
  counts: Counts;
};

export type ProcessResponse = {
  run: ProcessRun;
  artifacts: Artifact[];
  preview?: {
    t1_normal: any[];
    t1_ajustada: any[];
    t2_normal: any[];
    t2_ajustada: any[];
  };
  warnings?: string[];
};
