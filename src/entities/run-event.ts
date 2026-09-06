import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";
import { TrajectoryEntity } from "./trajectory";
import { TurnEntity } from "./turn";
import { runEventKinds, type RunEventKind } from "../store/types";

@Entity("run_events")
@Index(["trajectoryId", "sequence"], { unique: true })
@Index(["turnId", "sequence"])
export class RunEventEntity {
  @PrimaryColumn("text")
  id!: string;

  @Column("text")
  trajectoryId!: string;

  @ManyToOne(() => TrajectoryEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "trajectoryId" })
  trajectory?: TrajectoryEntity;

  @Column("text")
  turnId!: string;

  @ManyToOne(() => TurnEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "turnId" })
  turn?: TurnEntity;

  @Column("integer")
  sequence!: number;

  @Column("simple-enum", { enum: runEventKinds })
  kind!: RunEventKind;

  @Column("text")
  data!: string;

  @Column("datetime")
  ts!: Date;
}
