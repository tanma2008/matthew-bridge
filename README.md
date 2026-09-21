# Matthew Bridge

**Local bridge แบบ OpenAI-compatible สำหรับแอป CMU Matthew AI**

โปรเจกต์นี้เป็นการดัดแปลงจาก niawjunior/aipass-bridge โดยยังเก็บ implementation ของ AiPASS เดิมไว้ใน aipass-bridge/ เพื่อใช้อ้างอิงและให้เครดิต ส่วน implementation ที่ใช้งานจริงของ Matthew อยู่ใน matthew-core/ และ matthew-extension/

## สถาปัตยกรรม

    VS Code / OpenAI-compatible client
            |
            v
    127.0.0.1:8787
            |
            v
    Matthew Bridge
            |
            | SSE job relay
            v
    Chrome MV3 extension
            |
            v
    https://matthew.cmu.ac.th
            |
            v
    CMU Matthew AI

Bridge จะไม่เก็บ Matthew access token ไว้ในระบบ หน้า Chrome จะอ่าน session ของ Matthew ที่ผ่านการยืนยันตัวตนอยู่แล้วภายในเครื่อง และส่งคำขอ upstream จาก origin ของ Matthew โดยตรง ส่วน local server จะเห็นเฉพาะข้อมูล response ที่ถูก normalize แล้วเท่านั้น

## เริ่มต้นใช้งาน

    cd D:\matthew-bridge
    npm.cmd run dev

ปล่อย Terminal ให้ทำงานต่อ จากนั้นใน Chrome: chrome://extensions → Developer mode → Load unpacked → เลือก D:\matthew-bridge\matthew-extension

เปิด https://matthew.cmu.ac.th/ ด้วย Chrome profile เดียวกัน และเข้าสู่ระบบด้วย CMU Account จากนั้น popup ของ extension ควรแสดงว่า Connected

## ตรวจสอบระบบ

    npm.cmd run doctor
    npm.cmd run models

Endpoint ของ bridge:
http://127.0.0.1:8787/v1

## ตัวอย่าง OpenAI-compatible

Bridge รองรับการเชื่อมต่อจาก VS Code และ client ที่รองรับ OpenAI-compatible API โดยใช้ endpoint http://127.0.0.1:8787/v1

## CLI

    npm.cmd run matthew -- "สวัสดี Matthew Bridge"
    npm.cmd run doctor
    npm.cmd run models
