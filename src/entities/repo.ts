import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("repos")
@Index(["owner", "name"], { unique: true })
export class RepoEntity {
  @PrimaryColumn("text")
  id!: string;

  @Column("text")
  owner!: string;

  @Column("text")
  name!: string;

  @Column("text")
  defaultBranch!: string;

  @Column("boolean", { default: false })
  autoMerge!: boolean;

  @Column("datetime")
  createdAt!: Date;
}
