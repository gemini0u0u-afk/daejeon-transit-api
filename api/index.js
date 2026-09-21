const express = require('express');
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const parser = new xml2js.Parser({ explicitArray: false, trim: true });

const routeStationCache = {};
let masterRouteListCache = null;

app.get('/', (req, res) => {
  const filePath = path.join(process.cwd(), 'index.html');
  if (fs.existsSync(filePath)) return res.sendFile(filePath);
  res.send('대전 대중교통 관제 서버 가동 중');
});

// 1. 대전시 전체 노선 마스터 자동 동기화 (진짜 노선번호와 ID 1:1 매칭)
app.get('/api/bus/routes', async (req, res) => {
  const serviceKey = (process.env.PUBLIC_SERVICE_KEY || '').trim();
  if (!serviceKey) return res.status(500).json({ status: 'error', message: 'API 키 누락' });

  if (masterRouteListCache) {
    return res.json({ status: 'success', routes: masterRouteListCache });
  }

  const url = `https://apis.data.go.kr/6300000/busRouteInfo/getRouteInfoAll?serviceKey=${serviceKey}&reqPage=1`;
  try {
    const response = await axios.get(url, { timeout: 10000 });
    parser.parseString(response.data, (err, result) => {
      if (err) return res.status(500).json({ status: 'error', message: 'XML 파싱 실패' });

      const body = result?.ServiceResult?.msgBody;
      if (!body || !body.itemList) {
        return res.json({ status: 'success', routes: [] });
      }

      const list = Array.isArray(body.itemList) ? body.itemList : [body.itemList];
      
      // 주요 노선 필터링 및 정규 매핑
      const formatted = list.map(item => ({
        id: (item.ROUTE_CD || item.busRouteId || '').trim(),
        name: (item.ROUTE_NO || item.busRouteNm || '').trim(),
        type: item.ROUTE_TP === '1' ? 'express' : (item.ROUTE_TP === '3' ? 'branch' : 'trunk'),
        origin: item.ORIGIN_NM || '',
        dest: item.DEST_NM || '',
        desc: `${item.ORIGIN_NM || '기점'} ↔ ${item.DEST_NM || '종점'}`
      })).filter(r => r.id && r.name);

      masterRouteListCache = formatted;
      res.json({ status: 'success', count: formatted.length, routes: formatted });
    });
  } catch (err) {
    res.status(502).json({ status: 'error', message: err.message });
  }
});

// 2. 노선별 경유 정류소 목록
app.get('/api/bus/stations', async (req, res) => {
  const routeId = req.query.routeId;
  const serviceKey = (process.env.PUBLIC_SERVICE_KEY || '').trim();
  if (!routeId || !serviceKey) return res.status(400).json({ status: 'error', message: '인자 누락' });

  if (routeStationCache[routeId]) {
    return res.json({ status: 'success', cached: true, routeId, stations: routeStationCache[routeId] });
  }

  const url = `https://apis.data.go.kr/6300000/busRouteInfo/getStaionByRoute?serviceKey=${serviceKey}&busRouteId=${routeId}`;
  try {
    const response = await axios.get(url, { timeout: 10000 });
    parser.parseString(response.data, (err, result) => {
      if (err) return res.status(500).json({ status: 'error', message: 'XML 파싱 에러' });

      const body = result?.ServiceResult?.msgBody;
      if (!body || !body.itemList) return res.json({ status: 'success', routeId, stations: [] });

      const list = Array.isArray(body.itemList) ? body.itemList : [body.itemList];
      const stations = list.map(item => ({
        stationId: item.BUS_STOP_ID || item.STATION_ID,
        stationName: item.BUSSTOP_NM || item.STATION_NM,
        seq: parseInt(item.BUSSTOP_SEQ || item.STATION_SEQ || '0', 10),
        lat: parseFloat(item.GPS_LATI || item.LAT || 0),
        lng: parseFloat(item.GPS_LONG || item.LONG || 0)
      })).filter(s => s.lat > 35.0 && s.lng > 126.0)
        .sort((a, b) => a.seq - b.seq);

      routeStationCache[routeId] = stations;
      res.json({ status: 'success', cached: false, routeId, count: stations.length, stations });
    });
  } catch (err) {
    res.status(502).json({ status: 'error', message: err.message });
  }
});

// 3. 실시간 버스 위치
app.get('/api/bus/positions', async (req, res) => {
  const routeId = req.query.routeId;
  const serviceKey = (process.env.PUBLIC_SERVICE_KEY || '').trim();
  if (!routeId || !serviceKey) return res.status(400).json({ status: 'error', message: '인자 누락' });

  const url = `https://apis.data.go.kr/6300000/busposinfo/getBusPosByRtid?serviceKey=${serviceKey}&busRouteId=${routeId}`;
  try {
    const response = await axios.get(url, { timeout: 10000 });
    parser.parseString(response.data, (err, result) => {
      if (err) return res.status(500).json({ status: 'error', message: 'XML 파싱 에러' });

      const body = result?.ServiceResult?.msgBody;
      if (!body || !body.itemList) {
        return res.json({ status: 'success', routeId, count: 0, vehicles: [] });
      }

      const list = Array.isArray(body.itemList) ? body.itemList : [body.itemList];
      const vehicles = list.map(item => ({
        busId: item.BUS_ID,
        plateNo: item.CAR_REG_NO || '대전버스',
        routeId,
        lat: parseFloat(item.GPS_LATI || 0),
        lng: parseFloat(item.GPS_LONG || 0),
        stopSeq: parseInt(item.STATION_ORD || '0', 10),
        updatedAt: new Date().toISOString()
      })).filter(v => v.lat > 35.0 && v.lng > 126.0);

      res.json({ status: 'success', routeId, count: vehicles.length, vehicles });
    });
  } catch (err) {
    res.status(502).json({ status: 'error', message: err.message });
  }
});

// 4. 정류소별 실시간 도착 예정 정보
app.get('/api/bus/arrivals', async (req, res) => {
  const stopId = req.query.stopId;
  const serviceKey = (process.env.PUBLIC_SERVICE_KEY || '').trim();
  if (!stopId || !serviceKey) return res.status(400).json({ status: 'error', message: '인자 누락' });

  const url = `https://apis.data.go.kr/6300000/arrive/getArrInfoByStopID?serviceKey=${serviceKey}&BusStopID=${stopId}`;
  try {
    const response = await axios.get(url, { timeout: 8000 });
    parser.parseString(response.data, (err, result) => {
      if (err) return res.status(500).json({ status: 'error', message: 'XML 파싱 에러' });

      const body = result?.ServiceResult?.msgBody;
      if (!body || !body.itemList) return res.json({ status: 'success', stopId, count: 0, arrivals: [] });

      const list = Array.isArray(body.itemList) ? body.itemList : [body.itemList];
      const arrivals = list.map(item => ({
        routeName: item.ROUTE_NO || item.busRouteNm,
        remainMin: item.EXTIME_MIN || '-',
        remainStop: item.STATUS_POS || '-'
      }));
      res.json({ status: 'success', stopId, count: arrivals.length, arrivals });
    });
  } catch (err) {
    res.status(502).json({ status: 'error', message: err.message });
  }
});

module.exports = app;
