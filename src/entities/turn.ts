import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";
import { TrajectoryEntity } from "./trajectory";
import {
  turnKinds,
  turnStatuses,
  type TurnKind,
  type TurnStatus,
} from "../store/types";

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
  kind!: TurnKind;

  @Column("text")
  prompt!: string;

  @Column("simple-enum", { enum: turnStatuses })
  status!: TurnStatus;

  @Column("datetime")
  createdAt!: Date;

  @Column("datetime", { nullable: true })
  finishedAt!: Date | null;
}
