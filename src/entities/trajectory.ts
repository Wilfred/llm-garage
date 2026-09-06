import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";
import { RepoEntity } from "./repo";
import { trajectoryStatuses, type TrajectoryStatus } from "../store/types";

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
  status!: TrajectoryStatus;

  @Column("text")
  modelId!: string;

  @Column("text")
  taskPrompt!: string;

  @Column("text", { nullable: true })
  prUrl!: string | null;

  @Column("datetime")
  createdAt!: Date;

  @Column("datetime")
  updatedAt!: Date;
}
