"""V2: Hard-coded column indexes. Only latest file per type. No fuzzy matching."""
import csv, sqlite3, hashlib, os, json

DB = r'D:\douyin-video-dashboard\data\app.db'
DATA_DIRS = [
    r'E:\视频数据\2026抖音\2026-06_千川视频',
    r'Z:\摄影部\10.抖音信息流&视频号\0视频投放数据\抖音\2026-06_千川视频',
]
conn = sqlite3.connect(DB)
conn.execute('PRAGMA journal_mode=WAL')
conn.execute('PRAGMA foreign_keys=ON')

# Clean ALL metric data
for t in ['material_metrics','product_metrics','plan_metrics','report_files']:
    conn.execute(f'DELETE FROM {t}')
conn.commit()

now = '2026-06-26T00:00:00.000Z'
total = 0

def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''): h.update(chunk)
    return h.hexdigest()

def pn(s):
    s = s.strip().replace(',','').replace(chr(0xa5),'').replace('%','')
    if s in ('','-','--'): return 0.0
    try: return float(s)
    except: return 0.0

def ppct(s):
    v = pn(s)
    return v / 100.0 if '%' in s else v

# ====== Step 1: Find latest file per type ======
latest = {}  # type -> (path, mtime)
for root in DATA_DIRS:
    if not os.path.exists(root): continue
    for sub in ['视频','商品','计划']:
        sd = os.path.join(root, sub)
        if not os.path.exists(sd): continue
        for fn in os.listdir(sd):
            if not fn.endswith('.csv'): continue
            fp = os.path.join(sd, fn)
            mt = os.path.getmtime(fp)
            # Detect type from filename
            if '全域推广数据-视频' in fn:
                ft = 'video'
            elif '全域推广数据_商品' in fn:
                ft = 'product'
            elif '全域推广数据_计划' in fn:
                ft = 'plan'
            else:
                continue
            # Only use files from E: drive (latest exports)
            if 'E:' not in fp and root != DATA_DIRS[0]:
                continue
            if ft not in latest or mt > latest[ft][1]:
                latest[ft] = (fp, mt)

print('Latest files per type:')
for ft, (fp, mt) in latest.items():
    print(f'  {ft}: {os.path.basename(fp)}')

# ====== Step 2: Import only latest files ======
for ft, (fp, mt) in latest.items():
    fh = sha256_file(fp)
    st = os.stat(fp)
    fn = os.path.basename(fp)

    with open(fp, 'r', encoding='gbk') as f:
        reader = csv.reader(f)
        hdrs = next(reader)
        rows = [r[:len(hdrs)] for r in reader]

    cur = conn.execute('''INSERT INTO report_files(file_type,path,file_name,extension,hash,size,last_modified,imported_at,row_count,status,error)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)''',
        (ft,fp,fn,'.csv',fh,st.st_size,now,now,len(rows),'imported',''))
    fid = cur.lastrowid
    ins = 0

    if ft == 'video':
        for row in rows:
            name = row[1].strip()  # col[1]
            if not name or name == '全部': continue
            s = pn(row[8]); gg = pn(row[10]); ng = pn(row[16])
            conn.execute('''INSERT INTO material_metrics
                (material_id,material_name,material_created_at,metric_date,
                 impressions,clicks,click_rate,conversion_rate,spend,
                 gross_orders,gross_gmv,gross_roi,order_cost,cpm,cpc,
                 net_roi,net_gmv,net_orders,net_order_cost,net_settlement_rate,
                 refund_rate_1h,refund_amount_1h,
                 plays,completion_rate,avg_watch_seconds,rate_3s,rate_5s,
                 report_file_id,raw_json,imported_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                (row[0].strip(), name, row[2].strip(), row[3].strip(),
                 int(pn(row[4])), int(pn(row[5])), ppct(row[6]), ppct(row[7]),
                 s, int(pn(row[9])), gg, round(s>0 and gg/s or 0,4),
                 pn(row[12]), pn(row[13]), pn(row[14]),
                 round(s>0 and ng/s or 0,4), ng, int(pn(row[17])),
                 pn(row[18]), ppct(row[19]),
                 ppct(row[20]), pn(row[21]),
                 int(pn(row[22])), ppct(row[23]), pn(row[24]),
                 ppct(row[25]), ppct(row[26]),
                 fid, json.dumps(dict(zip(hdrs,row)),ensure_ascii=False), now))
            ins += 1

    elif ft == 'product':
        for row in rows:
            pname = row[1].strip()  # col[1]
            if not pname or pname == '全部': continue
            s = pn(row[7]); gg = pn(row[8]); ng = pn(row[15])
            conn.execute('''INSERT INTO product_metrics
                (product_id,product_name,metric_date,impressions,clicks,click_rate,
                 conversion_rate,spend,gross_gmv,gross_roi,order_cost,gross_orders,
                 actual_pay_amount,platform_subsidy,net_roi,net_gmv,net_orders,
                 net_order_cost,net_settlement_rate,refund_rate_1h,refund_amount_1h,
                 gmv_settlement_rate_7d,report_file_id,imported_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                (row[0].strip(), pname, row[2].strip(),
                 int(pn(row[3])), int(pn(row[4])), ppct(row[5]), ppct(row[6]),
                 s, gg, round(s>0 and gg/s or 0,4),
                 pn(row[10]), int(pn(row[11])),
                 pn(row[12]), pn(row[13]),
                 round(s>0 and ng/s or 0,4), ng,
                 int(pn(row[16])), pn(row[17]),
                 ppct(row[18]),
                 ppct(row[19]), pn(row[20]),
                 ppct(row[21]),
                 fid, now))
            ins += 1

    elif ft == 'plan':
        for row in rows:
            pid = row[1].strip()
            if not pid: continue
            s = pn(row[3]); gg = pn(row[5]); ng = pn(row[11])
            conn.execute('''INSERT INTO plan_metrics
                (plan_name,plan_id,metric_date,spend,gross_orders,gross_gmv,
                 gross_roi,order_cost,actual_pay_amount,platform_subsidy,
                 net_roi,net_gmv,net_order_cost,net_orders,net_settlement_rate,
                 refund_rate_1h,refund_amount_1h,gmv_settlement_rate_7d,
                 settled_amount_7d,settled_amount_14d,report_file_id,imported_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                (row[0].strip(), pid, row[2].strip(),
                 s, int(pn(row[4])), gg,
                 round(s>0 and gg/s or 0,4), pn(row[7]),
                 pn(row[8]), pn(row[9]),
                 round(s>0 and ng/s or 0,4), ng,
                 pn(row[12]), int(pn(row[13])),
                 ppct(row[14]),
                 ppct(row[15]), pn(row[16]),
                 ppct(row[17]),
                 pn(row[18]), pn(row[19]),
                 fid, now))
            ins += 1

    print(f'OK {fn}: {len(rows)} rows -> {ins} [{ft}]')
    total += ins

conn.commit()

# ====== VERIFICATION ======
print(f'\n=== 数据验证 (仅最新文件导入) ===')
for t in ['material_metrics','product_metrics','plan_metrics','report_files']:
    c = conn.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]
    print(f'{t}: {c} rows')

# Product KPI
r = conn.execute('SELECT SUM(spend),SUM(gross_gmv),SUM(net_gmv),SUM(net_orders),SUM(refund_amount_1h) FROM product_metrics WHERE metric_date=\"全部\"').fetchone()
print(f'\n=== 商品 KPI ===')
print(f'整体消耗: {r[0]:,.2f}')
print(f'整体成交金额: {r[1]:,.2f}')
print(f'净成交金额: {r[2]:,.2f}')
print(f'净成交订单数: {r[3]}')
print(f'1h退款: {r[4]:,.2f}')

# 祛痘
a = conn.execute('''SELECT SUM(spend),SUM(net_gmv),SUM(net_orders)
    FROM product_metrics WHERE metric_date=\"全部\"
    AND (product_name LIKE \"%苦参%\" OR product_name LIKE \"%祛痘%\")''').fetchone()
print(f'\n祛痘类: spend={a[0]:,.2f} net={a[1]:,.2f} orders={a[2]}')

# 视频
v = conn.execute('SELECT SUM(spend),SUM(gross_gmv),SUM(net_gmv),SUM(net_orders),SUM(plays),COUNT(DISTINCT material_name) FROM material_metrics WHERE metric_date=\"全部\"').fetchone()
print(f'\n视频: spend={v[0]:,.2f} gmv={v[1]:,.2f} net={v[2]:,.2f} orders={v[3]} plays={v[4]} materials={v[5]}')

# 计划
p = conn.execute('SELECT SUM(spend),SUM(net_gmv),SUM(net_orders),COUNT(DISTINCT plan_name) FROM plan_metrics WHERE metric_date=\"全部\"').fetchone()
print(f'\n计划: spend={p[0]:,.2f} net={p[1]:,.2f} orders={p[2]} plans={p[3]}')

# 交叉验证: plan total should = product total
print(f'\n交叉验证: plan spend={p[0]:,.2f} vs product spend={r[0]:,.2f} (应一致)')

# ====== 逐列验证关键产品 ======
print(f'\n=== 关键产品逐列验证 ===')
rows = conn.execute('SELECT product_name,spend,gross_gmv,net_gmv,net_orders FROM product_metrics WHERE metric_date=\"全部\" AND spend>5000 ORDER BY spend DESC').fetchall()
for row in rows:
    print(f'  {row[0][:30]}: spend={row[1]:,.2f} gmv={row[2]:,.2f} net={row[3]:,.2f} orders={row[4]}')

conn.close()
print('\nDone!')
