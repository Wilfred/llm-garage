import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity("settings")
export class Setting {
  @PrimaryColumn("text")
  key!: string;

  @Column("text")
  value!: string;
}
