import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";
import { TrajectoryEntity } from "./trajectory";

export const turnKinds = ["initial", "feedback", "spawn"] as const;
export const turnStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;

@Entity("turns")
@Index(["trajectoryId", "createdAt"])
export class TurnEntity {
  @PrimaryColumn("text")
  id!: string;

  @Column("text")
  trajectoryId!: string;

  @ManyToOne(() => TrajectoryEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "trajectoryId" })
  trajectory?: TrajectoryEntity;

  @Column("simple-enum", { enum: turnKinds })
  kind!: (typeof turnKinds)[number];

  @Column("text")
  prompt!: string;

  @Column("simple-enum", { enum: turnStatuses })
  status!: (typeof turnStatuses)[number];

  @Column("datetime")
  createdAt!: Date;

  @Column("datetime", { nullable: true })
  finishedAt!: Date | null;
}
