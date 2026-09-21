const express = require('express');
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');

const app = express();
app.use(cors());
app.use(express.json());

const parser = new xml2js.Parser({ explicitArray: false, trim: true });

app.get('/api/bus/positions', async (req, res) => {
  const routeId = req.query.routeId || '30300001';
  const serviceKey = process.env.PUBLIC_SERVICE_KEY;
  const url = 'http://openapigw.daejeon.go.kr/service/buspos/busPosList';

  try {
    const response = await axios.get(url, {
      params: {
        serviceKey: serviceKey,
        routeId: routeId
      },
      timeout: 6000
    });

    parser.parseString(response.data, (err, result) => {
      if (err) {
        return res.status(500).json({ status: 'error', message: 'XML 파싱 실패' });
      }

      const body = result?.ServiceResult?.msgBody;
      const header = result?.ServiceResult?.msgHeader;

      if (header && header.headerCd !== '0') {
        return res.json({ status: 'fail', headerMessage: header.headerMsg });
      }

      if (!body || !body.itemList) {
        return res.json({ status: 'success', count: 0, vehicles: [] });
      }

      const rawList = Array.isArray(body.itemList) ? body.itemList : [body.itemList];

      const formattedVehicles = rawList.map(item => ({
        busId: item.BUS_ID || item.busId,
        plateNo: item.CAR_REG_NO || item.plateNo || '대전버스',
        routeId: item.ROUTE_CD || routeId,
        lat: parseFloat(item.GPS_LATI || item.lat || 0),
        lng: parseFloat(item.GPS_LONG || item.lng || 0),
        stopSeq: item.STATION_ORD || item.stopSeq,
        updatedAt: new Date().toISOString()
      })).filter(v => v.lat > 36.0 && v.lng > 127.0);

      return res.json({
        status: 'success',
        routeId: routeId,
        count: formattedVehicles.length,
        vehicles: formattedVehicles
      });
    });
  } catch (error) {
    res.status(502).json({ status: 'error', message: error.message });
  }
});

module.exports = app;
