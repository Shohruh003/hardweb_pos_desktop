import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

// Tayyorlash bo'limi (sex): oshxona, bar, somsaxona, novvoyxona.
// Har bo'limning o'z LAN printeri bo'lishi mumkin — bo'sh bo'lsa chek chiqmaydi.
@Entity('stations')
export class StationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ name: 'printer_host', default: '' })
  printerHost: string;

  @Column({ name: 'printer_port', type: 'int', default: 9100 })
  printerPort: number;

  @Column({ name: 'printer_width', type: 'int', default: 48 })
  printerWidth: number;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;
}
