import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";
import { RepoEntity } from "./repo";

export const trajectoryStatuses = [
  "queued",
  "running",
  "awaiting_feedback",
  "succeeded",
  "failed",
  "cancelled",
  "archived",
] as const;

@Entity("trajectories")
@Index(["updatedAt"])
@Index(["repoId", "updatedAt"])
@Index(["parentId"])
@Index(["rootId"])
export class TrajectoryEntity {
  @PrimaryColumn("text")
  id!: string;

  @Column("text", { nullable: true })
  parentId!: string | null;

  @ManyToOne(() => TrajectoryEntity, { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn({ name: "parentId" })
  parent?: TrajectoryEntity | null;

  @Column("text")
  rootId!: string;

  @ManyToOne(() => TrajectoryEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "rootId" })
  root?: TrajectoryEntity;

  @Column("text")
  repoId!: string;

  @ManyToOne(() => RepoEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "repoId" })
  repo?: RepoEntity;

  @Column("text")
  title!: string;

  @Column("simple-enum", { enum: trajectoryStatuses })
  status!: (typeof trajectoryStatuses)[number];

  @Column("text")
  modelId!: string;

  @Column("text")
  taskPrompt!: string;

  @Column("boolean")
  createPr!: boolean;

  @Column("boolean")
  autoMerge!: boolean;

  @Column("text", { nullable: true })
  prUrl!: string | null;

  @Column("datetime")
  createdAt!: Date;

  @Column("datetime")
  updatedAt!: Date;
}
