"""Import CSV data -> SQLite. Hash dedup across all paths."""
import csv, sqlite3, hashlib, os, json

DB = r'D:\douyin-video-dashboard\data\app.db'
DATA_DIRS = [
    r'E:\视频数据\2026抖音\2026-06_千川视频',
    r'Z:\摄影部\10.抖音信息流&视频号\0视频投放数据\抖音\2026-06_千川视频',
]
conn = sqlite3.connect(DB)
conn.execute('PRAGMA journal_mode=WAL')
conn.execute('PRAGMA foreign_keys=ON')

# Clean slate
conn.execute('DELETE FROM material_metrics');
conn.execute('DELETE FROM product_metrics');
conn.execute('DELETE FROM plan_metrics');
conn.execute('DELETE FROM report_files');

seen_hashes = set()  # cross-path dedup
now = '2026-06-25T10:00:00.000Z'
total = 0

def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''): h.update(chunk)
    return h.hexdigest()

def parse_num(s):
    s = s.strip().replace(',','').replace('￥','').replace('%','')
    if s in ('','-','--'): return 0.0
    try: return float(s)
    except: return 0.0

def parse_pct(s): return parse_num(s) / 100.0 if '%' in s else parse_num(s)

def get_field(row, hdrs, candidates):
    for c in candidates:
        for i, h in enumerate(hdrs):
            if c in h and i < len(row): return row[i].strip()
    return ''

def detect_type(name):
    if '全域推广数据-视频' in name: return 'video'
    if '全域推广数据_商品' in name: return 'product'
    return None

for root in DATA_DIRS:
    if not os.path.exists(root):
        print(f'SKIP: {root}'); continue
    for sub in ['视频','商品','计划']:
        sd = os.path.join(root, sub)
        if not os.path.exists(sd): continue
        for fn in os.listdir(sd):
            if not fn.endswith('.csv'): continue
            fp = os.path.join(sd, fn)
            ft = detect_type(fn)
            if ft not in ('video','product','plan'): continue

            fh = sha256_file(fp)
            if fh in seen_hashes:
                print(f'  DEDUP {fn}')
                continue
            seen_hashes.add(fh)

            st = os.stat(fp)
            with open(fp, 'r', encoding='gbk') as f:
                reader = csv.reader(f)
                hdrs = next(reader)
                rows = [r[:len(hdrs)] for r in reader]

            cur = conn.execute('''INSERT INTO report_files
                (file_type, path, file_name, extension, hash, size, last_modified, imported_at, row_count, status, error)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)''',
                (ft, fp, fn, '.csv', fh, st.st_size, now, now, len(rows), 'imported', ''))
            fid = cur.lastrowid
            ins = 0

            for row in rows:
                if ft == 'video':
                    nm = get_field(row, hdrs, ['素材视频名称','视频名称'])
                    if not nm or nm == '全部': continue
                    s = parse_num(get_field(row, hdrs, ['整体消耗']))
                    ng = parse_num(get_field(row, hdrs, ['净成交金额']))
                    gg = parse_num(get_field(row, hdrs, ['整体成交金额']))
                    conn.execute('''INSERT INTO material_metrics
                        (material_id,material_name,material_created_at,metric_date,
                         impressions,clicks,click_rate,conversion_rate,spend,
                         gross_orders,gross_gmv,gross_roi,order_cost,cpm,cpc,
                         net_roi,net_gmv,net_orders,net_order_cost,net_settlement_rate,
                         refund_rate_1h,refund_amount_1h,
                         plays,completion_rate,avg_watch_seconds,rate_3s,rate_5s,
                         report_file_id,raw_json,imported_at)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                        (get_field(row,hdrs,['素材ID']),nm,get_field(row,hdrs,['素材创建时间']),get_field(row,hdrs,['日期']),
                         int(parse_num(get_field(row,hdrs,['整体展示次数']))),int(parse_num(get_field(row,hdrs,['整体点击次数']))),
                         parse_pct(get_field(row,hdrs,['整体点击率'])),parse_pct(get_field(row,hdrs,['整体转化率'])),
                         s,int(parse_num(get_field(row,hdrs,['整体成交订单数']))),
                         gg,round(s>0 and gg/s or 0,4),parse_num(get_field(row,hdrs,['整体成交订单成本'])),
                         parse_num(get_field(row,hdrs,['整体千次展现费用'])),parse_num(get_field(row,hdrs,['整体点击单价'])),
                         round(s>0 and ng/s or 0,4),ng,int(parse_num(get_field(row,hdrs,['净成交订单数']))),
                         parse_num(get_field(row,hdrs,['净成交订单成本'])),parse_pct(get_field(row,hdrs,['净成交金额结算率'])),
                         parse_pct(get_field(row,hdrs,['1小时内退款率'])),parse_num(get_field(row,hdrs,['1小时内退款金额'])),
                         int(parse_num(get_field(row,hdrs,['视频播放数']))),parse_pct(get_field(row,hdrs,['视频完播率'])),
                         parse_num(get_field(row,hdrs,['平均观看时长'])),parse_pct(get_field(row,hdrs,['3秒播放率'])),
                         parse_pct(get_field(row,hdrs,['5秒播放率'])),
                         fid,json.dumps(dict(zip(hdrs,row)),ensure_ascii=False),now))
                    ins += 1

                elif ft == 'product':
                    pn = get_field(row, hdrs, ['商品名称'])
                    if not pn or pn == '全部': continue
                    s = parse_num(get_field(row, hdrs, ['整体消耗']))
                    ng = parse_num(get_field(row, hdrs, ['净成交金额']))
                    gg = parse_num(get_field(row, hdrs, ['整体成交金额']))
                    conn.execute('''INSERT INTO product_metrics
                        (product_id,product_name,metric_date,impressions,clicks,click_rate,
                         conversion_rate,spend,gross_gmv,gross_roi,order_cost,gross_orders,
                         actual_pay_amount,platform_subsidy,net_roi,net_gmv,net_orders,
                         net_order_cost,net_settlement_rate,refund_rate_1h,refund_amount_1h,
                         gmv_settlement_rate_7d,report_file_id,imported_at)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                        (get_field(row,hdrs,['商品ID']),pn,get_field(row,hdrs,['日期']),
                         int(parse_num(get_field(row,hdrs,['整体展示次数']))),int(parse_num(get_field(row,hdrs,['整体点击次数']))),
                         parse_pct(get_field(row,hdrs,['整体点击率'])),parse_pct(get_field(row,hdrs,['整体转化率'])),
                         s,gg,round(s>0 and gg/s or 0,4),parse_num(get_field(row,hdrs,['整体成交订单成本'])),
                         int(parse_num(get_field(row,hdrs,['整体成交订单数']))),
                         parse_num(get_field(row,hdrs,['用户实际支付金额'])),parse_num(get_field(row,hdrs,['电商平台补贴金额'])),
                         round(s>0 and ng/s or 0,4),ng,int(parse_num(get_field(row,hdrs,['净成交订单数']))),
                         parse_num(get_field(row,hdrs,['净成交订单成本'])),parse_pct(get_field(row,hdrs,['净成交金额结算率'])),
                         parse_pct(get_field(row,hdrs,['1小时内退款率'])),parse_num(get_field(row,hdrs,['1小时内退款金额'])),
                         parse_pct(get_field(row,hdrs,['7日GMV结算率'])),
                         fid,now))
                    ins += 1

                elif ft == 'plan':
                    pn = get_field(row, hdrs, ['计划名称'])
                    pid = get_field(row, hdrs, ['计划ID'])
                    if not pid: continue
                    s = parse_num(get_field(row, hdrs, ['整体消耗']))
                    ng = parse_num(get_field(row, hdrs, ['净成交金额']))
                    gg = parse_num(get_field(row, hdrs, ['整体成交金额']))
                    conn.execute('''INSERT INTO plan_metrics
                        (plan_name, plan_id, metric_date, spend, gross_orders, gross_gmv,
                         gross_roi, order_cost, actual_pay_amount, platform_subsidy,
                         net_roi, net_gmv, net_order_cost, net_orders, net_settlement_rate,
                         refund_rate_1h, refund_amount_1h, gmv_settlement_rate_7d,
                         settled_amount_7d, settled_amount_14d, report_file_id, imported_at)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                        (pn, pid, get_field(row, hdrs, ['日期']),
                         s, int(parse_num(get_field(row, hdrs, ['整体成交订单数']))), gg,
                         round(s>0 and gg/s or 0,4), parse_num(get_field(row, hdrs, ['整体成交订单成本'])),
                         parse_num(get_field(row, hdrs, ['用户实际支付金额'])), parse_num(get_field(row, hdrs, ['电商平台补贴金额'])),
                         round(s>0 and ng/s or 0,4), ng,
                         parse_num(get_field(row, hdrs, ['净成交订单成本'])), int(parse_num(get_field(row, hdrs, ['净成交订单数']))),
                         parse_pct(get_field(row, hdrs, ['净成交金额结算率'])),
                         parse_pct(get_field(row, hdrs, ['1小时内退款率'])), parse_num(get_field(row, hdrs, ['1小时内退款金额'])),
                         parse_pct(get_field(row, hdrs, ['7日GMV结算率'])),
                         parse_num(get_field(row, hdrs, ['7日结算金额'])), parse_num(get_field(row, hdrs, ['14日结算金额'])),
                         fid, now))
                    ins += 1

            print(f'  OK {fn}: {len(rows)} rows -> {ins} [{ft}]')
            total += ins

conn.commit()

# Verify
print(f'\nTotal: {total}')
for t in ['material_metrics','product_metrics','report_files']:
    c = conn.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]
    print(f'  {t}: {c}')

r = conn.execute("""SELECT SUM(spend),SUM(gross_gmv),SUM(net_gmv),SUM(net_orders)
    FROM product_metrics WHERE metric_date='全部'""").fetchone()
print(f'\nKPI: Spend={r[0]:,.2f} GMV={r[1]:,.2f} Net={r[2]:,.2f} Orders={r[3]}')

conn.close()
print('Done!')
