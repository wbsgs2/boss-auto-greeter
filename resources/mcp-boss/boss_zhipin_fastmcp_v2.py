#!/usr/bin/env python3
"""
Boss直聘 FastMCP 服务器
基于FastMCP文档重新开发的现代化MCP服务器
"""

import asyncio
import json
import os
import time
import base64
import threading
from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional, Union
from pathlib import Path

import requests
from fastmcp import FastMCP, Context
from fastmcp.server.dependencies import get_http_request
from starlette.requests import Request
from starlette.responses import JSONResponse, FileResponse
from starlette.staticfiles import StaticFiles

from Crypto.Cipher import AES
from Crypto.Util.Padding import pad
from Crypto.Random import get_random_bytes

from playwright.async_api import async_playwright


# 数据模型定义
@dataclass
class LoginStatus:
    """登录状态数据模型"""
    is_logged_in: bool = False
    cookie: Optional[str] = None
    bst: Optional[str] = None
    qr_id: Optional[str] = None
    login_step: str = "idle"  # idle, qr_generated, scanned, confirmed, security_check, logged_in
    image_url: Optional[str] = None
    error_message: Optional[str] = None


@dataclass
class JobSearchConfig:
    """职位搜索配置"""
    experience_options: List[str]
    job_type_options: List[str]
    salary_options: List[str]
    default_params: Dict[str, Any]


@dataclass
class JobInfo:
    """职位信息数据模型"""
    job_id: str
    title: str
    company: str
    salary: str
    location: str
    experience: str
    education: str
    security_id: Optional[str] = None


@dataclass
class GreetingRequest:
    """打招呼请求数据模型"""
    security_id: str
    job_id: str
    message: str = "您好，我对这个职位很感兴趣，希望可以进一步沟通"


# 全局状态管理
class BossZhipinState:
    """Boss直聘全局状态管理"""

    def __init__(self):
        self.login_status = LoginStatus()
        self.session = None
        self.static_dir = Path("static")
        self.static_dir.mkdir(exist_ok=True)

    def get_session(self) -> requests.Session:
        """获取或创建HTTP会话"""
        if self.session is None:
            self.session = requests.Session()
            self.session.headers.update({
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://www.zhipin.com/web/user/?ka=header-login',
                'Origin': 'https://www.zhipin.com'
            })
        return self.session

    def update_login_status(self, **kwargs):
        """更新登录状态"""
        for key, value in kwargs.items():
            if hasattr(self.login_status, key):
                setattr(self.login_status, key, value)

    def reset_login(self):
        """重置登录状态"""
        self.login_status = LoginStatus()
        if self.session:
            self.session.cookies.clear()
            self.session = None


# 全局状态实例
state = BossZhipinState()


# 后台线程函数：在独立线程中调用scan接口，不阻塞主线程
def background_scan_monitor(qr_id: str):
    """在后台线程中监控扫码状态和确认状态，不阻塞主线程"""
    try:
        session = state.get_session()
        scan_url = f"https://www.zhipin.com/wapi/zppassport/qrcode/scan?uuid={qr_id}"
        confirm_url = f"https://www.zhipin.com/wapi/zppassport/qrcode/scanLogin?qrId={qr_id}&status=1"

        # 阶段1：等待扫码（长轮询）
        print(f"[后台监控] 开始监控扫码状态，QR ID: {qr_id}")
        scan_count = 0
        while True:
            if state.login_status.login_step == "logged_in":
                print(f"[后台监控] 已登录，停止监控")
                return

            try:
                scan_count += 1
                print(f"[后台监控] 第{scan_count}次调用scan接口")
                resp = session.get(scan_url, timeout=35)

                # 检查响应内容，而不只是状态码
                if resp.status_code == 200:
                    json_data = resp.json()
                    if json_data.get("scaned"):
                        print(f"[后台监控] ✅ 检测到用户已扫码，进入确认阶段")
                        state.update_login_status(login_step="scanned")
                        break  # 退出扫码循环，进入确认阶段
                    elif json_data.get("msg") == "timeout":
                        print(f"[后台监控] ⏱️ 等待扫码超时，继续轮询... ({scan_count})")
                    else:
                        print(f"[后台监控] 🔄 轮询中... ({scan_count}) - {json_data}")
                else:
                    print(f"[后台监控] ⚠️ 未知扫码状态码: {resp.status_code}")

            except requests.exceptions.ReadTimeout:
                print(f"[后台监控] ⏱️ 等待扫码超时，继续轮询... ({scan_count})")
                continue
            except Exception as e:
                print(f"[后台监控] ❌ 调用scan接口出错: {e}")
                time.sleep(2)

            time.sleep(1)

        # 阶段2：等待确认（长轮询）
        if state.login_status.login_step == "scanned":
            print(f"[后台监控] 开始监控确认状态")
            confirm_count = 0
            while True:
                try:
                    confirm_count += 1
                    print(f"[后台监控] 第{confirm_count}次调用confirm接口")
                    resp = session.get(confirm_url, timeout=35)

                    # 检查响应内容
                    if resp.status_code == 200:
                        print(f"[后台监控] ✅ 用户已确认登录，获取Cookie")

                        # 获取最终Cookie
                        i_str = "8048b8676fb7d3d8952276e6e98e0bde.f2dc7a63c4b0fbfa4b51a07e2710cf83.fef7e750fc3a1e6327e8a880915aee9c.ae00f848beb1aa591d71d5a80dd3bd95"
                        e_b64 = "clRwXUJBK1VKK0k0IWFbbQ=="

                        key_bytes = base64.b64decode(e_b64)
                        plaintext_bytes = i_str.encode('utf-8')
                        iv_bytes = get_random_bytes(16)
                        cipher = AES.new(key_bytes, AES.MODE_CBC, iv_bytes)
                        padded_plaintext = pad(plaintext_bytes, AES.block_size)
                        ciphertext_bytes = cipher.encrypt(padded_plaintext)
                        result_bytes = iv_bytes + ciphertext_bytes
                        fp = base64.b64encode(result_bytes).decode('utf-8')

                        dispatcher_url = f"https://www.zhipin.com/wapi/zppassport/qrcode/dispatcher?qrId={qr_id}&pk=header-login&fp={fp}"
                        cookie_resp = session.get(dispatcher_url, allow_redirects=False)

                        # 解析Cookie
                        set_cookie_headers = cookie_resp.headers.get('Set-Cookie', '')
                        cookie_str = ''
                        bst_value = ''

                        if set_cookie_headers:
                            cookies = {}
                            cookie_parts = set_cookie_headers.split(',')
                            for part in cookie_parts:
                                if '=' in part:
                                    name_value = part.strip().split(';')[0].strip()
                                    if '=' in name_value:
                                        name, value = name_value.split('=', 1)
                                        cookies[name.strip()] = value.strip()

                            cookie_str = '; '.join([f"{k}={v}" for k, v in cookies.items()])
                            # if 'wt2' in cookies:
                            #     cookie_str = f"wt2={cookies['wt2']}"
                            if 'bst' in cookies:
                                bst_value = cookies['bst']

                        # 阶段3：使用无头浏览器完成安全验证
                        print(f"[后台监控] 开始安全验证流程...")
                        state.update_login_status(login_step="security_check")

                        # 在新的事件循环中运行异步安全验证
                        try:
                            # 创建新的事件循环（因为我们在同步线程中）
                            loop = asyncio.new_event_loop()
                            asyncio.set_event_loop(loop)

                            # 运行安全验证
                            final_cookie_str = loop.run_until_complete(
                                BossZhipinAPI.complete_security_check(cookie_str)
                            )

                            loop.close()

                            print(f"[后台监控] ✅ 安全验证完成")

                            # 使用最终 Cookie 更新 session
                            for cookie_pair in final_cookie_str.split('; '):
                                if '=' in cookie_pair:
                                    name, value = cookie_pair.split('=', 1)
                                    session.cookies.set(name, value)

                            # 更新状态为最终 Cookie
                            state.update_login_status(
                                is_logged_in=True,
                                cookie=final_cookie_str,
                                bst=bst_value,
                                login_step="logged_in"
                            )

                            print(f"[后台监控] 🎉 登录成功！最终 Cookie 已保存")

                        except Exception as e:
                            print(f"[后台监控] ⚠️ 安全验证失败，使用初始 Cookie: {e}")

                            # 如果安全验证失败，仍然使用初始 Cookie
                            if cookie_str:
                                for cookie_pair in cookie_str.split('; '):
                                    if '=' in cookie_pair:
                                        name, value = cookie_pair.split('=', 1)
                                        session.cookies.set(name, value)

                            state.update_login_status(
                                is_logged_in=True,
                                cookie=cookie_str,
                                bst=bst_value,
                                login_step="logged_in"
                            )

                            print(f"[后台监控] 🎉 登录成功！初始 Cookie 已保存")

                        return
                    else:
                        # 检查响应内容
                        json_data = resp.json()
                        if json_data.get("msg") == "timeout":
                            print(f"[后台监控] ⏱️ 等待确认超时，继续轮询... ({confirm_count})")
                        else:
                            print(f"[后台监控] 🔄 轮询中... ({confirm_count}) - {json_data}")

                except requests.exceptions.ReadTimeout:
                    print(f"[后台监控] ⏱️ 等待确认超时，继续轮询... ({confirm_count})")
                    continue
                except Exception as e:
                    print(f"[后台监控] ❌ 调用confirm接口出错: {e}")
                    time.sleep(2)

                time.sleep(1)

    except Exception as e:
        print(f"[后台监控] ❌ 监控线程异常: {e}")
    finally:
        print(f"[后台监控] 监控线程结束")


# Boss直聘API工具类
class BossZhipinAPI:
    """Boss直聘API操作类"""

    @staticmethod
    def generate_fp(i_str: str, e_b64: str) -> str:
        """生成设备指纹参数"""
        key_bytes = base64.b64decode(e_b64)
        plaintext_bytes = i_str.encode('utf-8')
        iv_bytes = get_random_bytes(16)

        cipher = AES.new(key_bytes, AES.MODE_CBC, iv_bytes)
        padded_plaintext = pad(plaintext_bytes, AES.block_size)
        ciphertext_bytes = cipher.encrypt(padded_plaintext)

        result_bytes = iv_bytes + ciphertext_bytes
        return base64.b64encode(result_bytes).decode('utf-8')

    @staticmethod
    async def complete_security_check(initial_cookie: str) -> str:
        """使用无头浏览器完成安全验证，获取最终 Cookie

        Args:
            initial_cookie: 从 dispatcher 接口获取的初始 Cookie

        Returns:
            包含 __zp_stoken__ 的最终 Cookie 字符串
        """
        # 固定的 security-check URL 参数
        security_check_url = (
            "https://www.zhipin.com/web/common/security-check.html?"
            "seed=ttttZij2JIIK%2BxUw73%2B6ZmzsaYKTbDQuIH6OR6Bm54o%3D"
            "&name=e331459e"
            "&ts=1762256958405"
            "&callbackUrl=https%3A%2F%2Fwww.zhipin.com%2Fweb%2Fgeek%2Fjobs"
        )

        print(f"[安全验证] 开始使用无头浏览器完成安全验证")

        try:
            async with async_playwright() as p:
                # 启动无头浏览器
                browser = await p.chromium.launch(headless=True)
                context = await browser.new_context()

                # 解析并设置初始 Cookie
                cookies = []
                for cookie_pair in initial_cookie.split('; '):
                    if '=' in cookie_pair:
                        name, value = cookie_pair.split('=', 1)
                        cookies.append({
                            'name': name,
                            'value': value,
                            'domain': '.zhipin.com',
                            'path': '/'
                        })

                await context.add_cookies(cookies)
                print(f"[安全验证] 已设置初始 Cookie，共 {len(cookies)} 个")

                # 访问 security-check 页面
                page = await context.new_page()
                print(f"[安全验证] 正在访问 security-check 页面...")
                await page.goto(security_check_url, wait_until='domcontentloaded')

                # 等待网络空闲
                print(f"[安全验证] 等待网络空闲...")
                try:
                    await page.wait_for_load_state('networkidle', timeout=30000)
                    print(f"[安全验证] ✅ 网络已空闲")
                except Exception as e:
                    print(f"[安全验证] ⚠️ 等待网络空闲超时: {e}")

                # 额外等待，确保 JS 执行完成并设置 Cookie
                print(f"[安全验证] 额外等待 3 秒，确保 Cookie 完全设置...")
                await asyncio.sleep(3)

                # 方法1：通过 JS 直接从页面读取 Cookie
                print(f"[安全验证] 通过 JavaScript 读取页面 Cookie...")
                js_cookies = await page.evaluate("() => document.cookie")
                print(f"[安全验证] JS 获取的 Cookie: {js_cookies[:200]}...")

                # 方法2：通过 Playwright API 获取 Cookie
                print(f"[安全验证] 通过 Playwright API 获取 Cookie...")
                final_cookies = await context.cookies()
                playwright_cookie_str = '; '.join([f"{c['name']}={c['value']}" for c in final_cookies])
                print(f"[安全验证] Playwright API 获取的 Cookie: {playwright_cookie_str[:200]}...")

                # 使用 JS 读取的 Cookie（这是浏览器中真实的 Cookie）
                final_cookie_str = js_cookies

                # 检查是否有 __zp_stoken__
                has_stoken = '__zp_stoken__' in js_cookies
                if has_stoken:
                    # 从 Cookie 字符串中提取 __zp_stoken__ 的值
                    for cookie_pair in js_cookies.split('; '):
                        if cookie_pair.startswith('__zp_stoken__='):
                            stoken_value = cookie_pair.split('=', 1)[1]
                            print(f"[安全验证] ✅ 成功获取 __zp_stoken__: {stoken_value[:20]}...")
                            break
                else:
                    print(f"[安全验证] ⚠️ 未找到 __zp_stoken__")

                print(f"[安全验证] ✅ 安全验证完成")

                # 关闭浏览器
                await browser.close()

                return final_cookie_str

        except Exception as e:
            print(f"[安全验证] ❌ 安全验证失败: {e}")
            # 如果失败，返回初始 Cookie
            return initial_cookie

    @staticmethod
    async def get_randkey(session: requests.Session) -> str:
        """获取登录随机密钥"""
        url = "https://www.zhipin.com/wapi/zppassport/captcha/randkey"
        resp = session.post(url)
        resp.raise_for_status()
        return resp.json()["zpData"]["qrId"]

    @staticmethod
    def get_randkey_sync(session: requests.Session) -> str:
        """获取登录随机密钥（同步版本）"""
        url = "https://www.zhipin.com/wapi/zppassport/captcha/randkey"
        resp = session.post(url)
        resp.raise_for_status()
        return resp.json()["zpData"]["qrId"]

    @staticmethod
    async def get_qrcode(session: requests.Session, qr_id: str) -> bytes:
        """获取二维码图片数据"""
        url = f"https://www.zhipin.com/wapi/zpweixin/qrcode/getqrcode?content={qr_id}"
        resp = session.get(url)
        resp.raise_for_status()
        return resp.content

    @staticmethod
    def get_qrcode_sync(session: requests.Session, qr_id: str) -> bytes:
        """获取二维码图片数据（同步版本）"""
        url = f"https://www.zhipin.com/wapi/zpweixin/qrcode/getqrcode?content={qr_id}"
        resp = session.get(url)
        resp.raise_for_status()
        return resp.content

    @staticmethod
    async def check_scan_status(session: requests.Session, qr_id: str) -> int:
        """检查扫码状态"""
        url = f"https://www.zhipin.com/wapi/zppassport/qrcode/scan?uuid={qr_id}"
        resp = session.get(url, timeout=60)  # 使用短超时避免长时间阻塞
        return resp.status_code

    @staticmethod
    async def check_login_confirmation(session: requests.Session, qr_id: str) -> int:
        """检查登录确认状态"""
        url = f"https://www.zhipin.com/wapi/zppassport/qrcode/scanLogin?qrId={qr_id}&status=1"
        resp = session.get(url, timeout=60)  # 使用短超时避免长时间阻塞
        return resp.status_code

    @staticmethod
    async def get_final_cookie(session: requests.Session, qr_id: str) -> tuple[str, str]:
        """获取最终登录Cookie"""
        # 使用与 login_verifier.py 相同的参数和URL
        i_str = "8048b8676fb7d3d8952276e6e98e0bde.f2dc7a63c4b0fbfa4b51a07e2710cf83.fef7e750fc3a1e6327e8a880915aee9c.ae00f848beb1aa591d71d5a80dd3bd95"
        e_b64 = "clRwXUJBK1VKK0k0IWFbbQ=="

        # 生成fp参数
        fp = BossZhipinAPI.generate_fp(i_str, e_b64)

        # 使用正确的 dispatcher URL
        dispatcher_url = f"https://www.zhipin.com/wapi/zppassport/qrcode/dispatcher?qrId={qr_id}&pk=header-login&fp={fp}"
        resp = session.get(dispatcher_url, allow_redirects=False)

        # 解析Set-Cookie头
        set_cookie_headers = resp.headers.get('Set-Cookie', '')
        cookie_str = ''
        bst_value = ''

        if set_cookie_headers:
            # 解析Cookie
            cookies = {}
            cookie_parts = set_cookie_headers.split(',')
            for part in cookie_parts:
                if '=' in part:
                    name_value = part.strip().split(';')[0].strip()
                    if '=' in name_value:
                        name, value = name_value.split('=', 1)
                        cookies[name.strip()] = value.strip()

            # 构建cookie字符串
            cookie_str = '; '.join([f"{k}={v}" for k, v in cookies.items()])

            # 查找特定的cookie值
            if 'wt2' in cookies:
                cookie_str = f"wt2={cookies['wt2']}"
            if 'bst' in cookies:
                bst_value = cookies['bst']

        # 设置Cookie到会话
        if cookie_str:
            session.headers['Cookie'] = cookie_str

        return cookie_str, bst_value

    @staticmethod
    def setup_api_headers(session: requests.Session, cookie: str, bst: str):
        """设置API请求头"""
        session.headers.update({
            'Cookie': cookie,
            'zp_token': bst,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://www.zhipin.com/web/user/?ka=header-login',
            'Origin': 'https://www.zhipin.com'
        })

    # 参数映射表（参考 TypeScript 版本）
    EXPERIENCE_MAP = {
        '在校生': 108,
        '应届生': 102,
        '不限': 101,
        '一年以内': 103,
        '一到三年': 104,
        '三到五年': 105,
        '五到十年': 106,
        '十年以上': 107
    }

    JOB_TYPE_MAP = {
        '全职': 1901,
        '兼职': 1903,
    }

    SALARY_MAP = {
        '3k以下': 402,
        '3-5k': 403,
        '5-10k': 404,
        '10-20k': 405,
        '20-50k': 406,
        '50以上': 407,
    }

    @staticmethod
    async def get_job_list(session: requests.Session, params: dict) -> dict:
        """获取职位列表"""
        url = "https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json"

        # 转换文本参数为代码
        converted_params = {}
        if 'experience' in params and params['experience'] in BossZhipinAPI.EXPERIENCE_MAP:
            converted_params['experience'] = BossZhipinAPI.EXPERIENCE_MAP[params['experience']]

        if 'jobType' in params and params['jobType'] in BossZhipinAPI.JOB_TYPE_MAP:
            converted_params['jobType'] = BossZhipinAPI.JOB_TYPE_MAP[params['jobType']]

        if 'salary' in params and params['salary'] in BossZhipinAPI.SALARY_MAP:
            converted_params['salary'] = BossZhipinAPI.SALARY_MAP[params['salary']]

        # 设置默认参数
        default_params = {
            "page": 1,
            "pageSize": 15,
            "_": int(time.time() * 1000)  # 时间戳
        }
        default_params.update(converted_params)

        # 添加其他参数（如 encryptExpectId 等）
        for key in ['page', 'pageSize', 'encryptExpectId']:
            if key in params:
                default_params[key] = params[key]

        try:
            resp = session.get(url, params=default_params, timeout=10)
            resp.raise_for_status()

            data = resp.json()

            if data.get("code") != 0:
                raise Exception(f"API错误: {data.get('message', '未知错误')}")

            zp_data = data.get("zpData", {})
            job_list = zp_data.get("jobList", [])

            # 转换为标准格式
            jobs = []
            for job in job_list:
                job_info = {
                    "securityId": job.get("securityId"),
                    "encryptBossId": job.get("encryptBossId"),
                    "jobDegree": job.get("jobDegree"),
                    "jobName": job.get("jobName"),
                    "lid": job.get("lid"),
                    "salaryDesc": job.get("salaryDesc"),
                    "jobLabels": job.get("jobLabels", []),
                    "skills": job.get("skills", []),
                    "jobExperience": job.get("jobExperience"),
                    "cityName": job.get("cityName"),
                    "areaDistrict": job.get("areaDistrict"),
                    "encryptBrandId": job.get("encryptBrandId"),
                    "brandName": job.get("brandName"),
                    "brandScaleName": job.get("brandScaleName"),
                    "industry": job.get("industry"),
                    "contact": job.get("contact", False),
                    "showTopPosition": job.get("showTopPosition", False)
                }
                jobs.append(job_info)

            return {
                "status": "success",
                "data": {
                    "hasMore": zp_data.get("hasMore", False),
                    "jobList": jobs,
                    "total": len(jobs)
                }
            }

        except requests.RequestException as e:
            return {
                "status": "error",
                "message": f"网络请求失败: {str(e)}"
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"获取职位失败: {str(e)}"
            }

    @staticmethod
    async def greet_boss(session: requests.Session, security_id: str, job_id: str) -> dict:
        """向HR发送打招呼"""
        url = "https://www.zhipin.com/wapi/zpgeek/friend/add.json"

        params = {
            "securityId": security_id,
            "jobId": job_id
        }

        try:
            resp = session.get(url, params=params, timeout=10)
            resp.raise_for_status()

            data = resp.json()

            if data.get("code") != 0:
                raise Exception(f"API错误: {data.get('message', '未知错误')}")

            zp_data = data.get("zpData", {})

            return {
                "status": "success",
                "message": "打招呼发送成功",
                "data": {
                    "showGreeting": zp_data.get("showGreeting", False),
                    "securityId": zp_data.get("securityId"),
                    "bossSource": zp_data.get("bossSource"),
                    "source": zp_data.get("source"),
                    "encBossId": zp_data.get("encBossId")
                }
            }

        except requests.RequestException as e:
            return {
                "status": "error",
                "message": f"网络请求失败: {str(e)}"
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"发送打招呼失败: {str(e)}"
            }


# 创建FastMCP服务器实例
mcp = FastMCP(
    name="Boss直聘 MCP Server",
    host="127.0.0.1",
    port=8000,
    log_level="info"
)


# 静态文件路由
@mcp.custom_route("/static/{filename:path}", methods=["GET"])
async def serve_static_file(request: Request) -> FileResponse:
    """提供静态文件服务"""
    filename = request.path_params["filename"]
    file_path = state.static_dir / filename

    if file_path.exists() and file_path.is_file():
        return FileResponse(str(file_path))

    return JSONResponse(
        {"error": "文件未找到", "filename": filename},
        status_code=404
    )


# Resources 定义
@mcp.resource("boss-zp://status")
async def get_server_status() -> str:
    """获取服务器状态"""
    return json.dumps({
        "server": "Boss直聘 MCP Server",
        "version": "2.0.0",
        "status": "running",
        "login_status": asdict(state.login_status)
    }, ensure_ascii=False, indent=2)


@mcp.resource("boss-zp://config")
async def get_job_config() -> str:
    """获取职位搜索配置"""
    config = {
        "experience": BossZhipinAPI.EXPERIENCE_MAP,
        "jobType": BossZhipinAPI.JOB_TYPE_MAP,
        "salary": BossZhipinAPI.SALARY_MAP,
        "default_params": {
            "experience": "不限",
            "jobType": "全职",
            "salary": "不限",
            "page": 1
        }
    }
    return json.dumps(config, ensure_ascii=False, indent=2)


@mcp.resource("boss-zp://login/start")
async def start_login(ctx: Context) -> str:
    """启动登录流程"""
    try:
        await ctx.info("开始启动Boss直聘登录流程")

        # 重置登录状态
        state.reset_login()

        # 获取会话
        session = state.get_session()

        # 步骤1：获取随机密钥（使用同步方式）
        qr_id = BossZhipinAPI.get_randkey_sync(session)
        state.update_login_status(qr_id=qr_id, login_step="qr_generated")

        # 步骤2：获取二维码（使用同步方式）
        qr_image_data = BossZhipinAPI.get_qrcode_sync(session, qr_id)

        # 保存二维码图片
        filename = f"qrcode_{qr_id}.png"
        filepath = state.static_dir / filename

        with open(filepath, "wb") as f:
            f.write(qr_image_data)

        # 生成图片URL
        image_url = f"http://127.0.0.1:8000/static/{filename}"
        state.update_login_status(image_url=image_url)

        await ctx.info(f"二维码已生成，QR ID: {qr_id}")

        return json.dumps({
            "status": "success",
            "message": "二维码已生成，请访问以下URL查看二维码图片",
            "qr_id": qr_id,
            "image_url": image_url,
            "login_step": "qr_generated"
        }, ensure_ascii=False, indent=2)

    except Exception as e:
        error_msg = f"启动登录流程失败: {str(e)}"
        await ctx.error(error_msg)
        state.update_login_status(error_message=error_msg)

        return json.dumps({
            "status": "error",
            "message": error_msg
        }, ensure_ascii=False, indent=2)


@mcp.resource("boss-zp://login/info")
async def get_login_info(ctx: Context) -> str:
    """获取当前登录状态和Cookie信息"""
    try:
        login_status = state.login_status

        # 构建响应信息
        result = {
            "is_logged_in": login_status.is_logged_in,
            "login_step": login_status.login_step,
            "qr_id": login_status.qr_id,
            "image_url": login_status.image_url,
            "error_message": login_status.error_message
        }

        # 如果已登录，添加Cookie信息
        if login_status.is_logged_in:
            result["cookie"] = login_status.cookie
            result["bst"] = login_status.bst

            # 解析Cookie显示详细信息
            if login_status.cookie:
                cookies_dict = {}
                for cookie_pair in login_status.cookie.split('; '):
                    if '=' in cookie_pair:
                        name, value = cookie_pair.split('=', 1)
                        cookies_dict[name] = value
                result["cookies_detail"] = cookies_dict

            await ctx.info("✅ 已登录")
        else:
            await ctx.info(f"⏳ 当前状态: {login_status.login_step}")

        return json.dumps(result, ensure_ascii=False, indent=2)

    except Exception as e:
        error_msg = f"获取登录信息失败: {str(e)}"
        await ctx.error(error_msg)
        return json.dumps({
            "status": "error",
            "message": error_msg
        }, ensure_ascii=False, indent=2)


@mcp.resource("boss-zp://jobs/{page}/{experience}/{job_type}/{salary}")
async def get_recommend_jobs(
    page: int,
    experience: str,
    job_type: str,
    salary: str,
    ctx: Context
) -> str:
    """获取推荐职位"""
    try:
        if not state.login_status.is_logged_in:
            return json.dumps({
                "error": "未登录",
                "message": "请先完成登录再获取职位信息"
            }, ensure_ascii=False, indent=2)

        await ctx.info(f"获取推荐职位: 页码{page}, 经验{experience}, 类型{job_type}, 薪资{salary}")

        session = state.get_session()
        headers = {
            'Cookie': state.login_status.cookie,
            'Origin': 'https://www.zhipin.com',
            'Referer': 'https://www.zhipin.com/web/geek/job',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }

        # TODO: 实现具体的职位获取API调用
        # 这里暂时返回示例数据
        jobs = [
            JobInfo(
                job_id="example_job_1",
                title="高级Python开发工程师",
                company="示例科技公司",
                salary="15-25k",
                location="北京",
                experience=experience,
                education="本科",
                security_id="example_security_1"
            ),
            JobInfo(
                job_id="example_job_2",
                title="全栈开发工程师",
                company="示例互联网公司",
                salary="20-35k",
                location="上海",
                experience=experience,
                education="本科",
                security_id="example_security_2"
            )
        ]

        result = {
            "status": "success",
            "data": {
                "page": page,
                "experience": experience,
                "job_type": job_type,
                "salary": salary,
                "total": len(jobs),
                "jobs": [asdict(job) for job in jobs]
            }
        }

        await ctx.info(f"成功获取 {len(jobs)} 个职位")
        return json.dumps(result, ensure_ascii=False, indent=2)

    except Exception as e:
        error_msg = f"获取职位失败: {str(e)}"
        await ctx.error(error_msg)
        return json.dumps({
            "error": "获取职位失败",
            "message": error_msg
        }, ensure_ascii=False, indent=2)


# Tools 定义
@mcp.tool()
async def login_full_auto(ctx: Context) -> str:
    """完全自动化登录流程，生成二维码并在后台监控扫码状态（无交互版本）"""
    try:
        await ctx.info("开始自动化登录流程")

        # 启动登录并生成二维码
        session = state.get_session()
        qr_id = await BossZhipinAPI.get_randkey(session)
        state.update_login_status(qr_id=qr_id, login_step="qr_generated")

        # 获取二维码
        qr_image_data = await BossZhipinAPI.get_qrcode(session, qr_id)

        # 保存二维码图片
        filename = f"qrcode_{qr_id}.png"
        filepath = state.static_dir / filename

        with open(filepath, "wb") as f:
            f.write(qr_image_data)

        # 生成图片URL
        image_url = f"http://127.0.0.1:8000/static/{filename}"
        state.update_login_status(image_url=image_url)

        # 启动后台线程监控扫码状态，不阻塞主线程
        monitor_thread = threading.Thread(target=background_scan_monitor, args=(qr_id,), daemon=True)
        monitor_thread.start()

        await ctx.info(f"二维码已生成: {image_url}")
        await ctx.info("后台监控线程已启动，二维码将保持有效1分钟")

        return json.dumps({
            "status": "qr_generated",
            "message": "二维码已生成，后台监控已启动",
            "qr_id": qr_id,
            "image_url": image_url,
            "login_step": "qr_generated",
            "next_action": "请使用Boss直聘APP扫码，后台会自动监控登录状态。可通过 boss-zp://login/info 或 get_login_info_tool 查看登录进度和Cookie"
        }, ensure_ascii=False, indent=2)

    except Exception as e:
        error_msg = f"自动登录失败: {str(e)}"
        await ctx.error(error_msg)
        return json.dumps({
            "status": "error",
            "message": error_msg
        }, ensure_ascii=False, indent=2)


@mcp.tool()
async def login_start_interactive(ctx: Context) -> str:
    """交互式启动登录流程，引导用户完成扫码和确认"""
    try:
        await ctx.info("开始交互式登录流程")

        while True:  # 外层循环处理整个登录流程重试
            while True:  # 内层循环处理重新生成二维码的情况
                # 步骤1：启动登录并生成二维码
                session = state.get_session()
                qr_id = await BossZhipinAPI.get_randkey(session)
                state.update_login_status(qr_id=qr_id, login_step="qr_generated")

                # 获取二维码
                qr_image_data = await BossZhipinAPI.get_qrcode(session, qr_id)

                # 保存二维码图片
                filename = f"qrcode_{qr_id}.png"
                filepath = state.static_dir / filename

                with open(filepath, "wb") as f:
                    f.write(qr_image_data)

                # 生成图片URL
                image_url = f"http://127.0.0.1:8000/static/{filename}"
                state.update_login_status(image_url=image_url)

                # 显示二维码信息
                await ctx.info("=" * 50)
                await ctx.info("🔥 Boss直聘登录二维码已生成！")
                await ctx.info(f"📱 二维码图片URL: {image_url}")
                await ctx.info(f"🆔 QR ID: {qr_id}")
                await ctx.info("=" * 50)

                # 步骤2：询问用户是否已扫码
                scan_result = await ctx.elicit(
                    "请使用Boss直聘APP扫描上方的二维码图片，扫描完成后请选择'已扫码'",
                    response_type=["已扫码", "重新生成二维码", "取消登录"]
                )

                if scan_result.action != "accept" or scan_result.data not in ["已扫码", "重新生成二维码"]:
                    return json.dumps({
                        "status": "cancelled",
                        "message": "用户取消了登录流程"
                    }, ensure_ascii=False, indent=2)

                # 如果用户选择重新生成二维码，继续内层循环
                if scan_result.data == "重新生成二维码":
                    await ctx.info("正在重新生成二维码...")
                    state.reset_login()
                    continue

                # 步骤3：检查扫码状态
                await ctx.info("🔍 正在验证扫码状态...")
                status_code = await BossZhipinAPI.check_scan_status(session, qr_id)

                if status_code == 200:
                    scan_check = {"status": "scanned"}
                elif status_code == 409:
                    scan_check = {"status": "waiting"}
                else:
                    scan_check = {"status": "error", "message": f"未知状态: {status_code}"}

                if scan_check["status"] != "scanned":
                    await ctx.warning("⚠️ 未检测到扫码状态，请确认是否已成功扫码")
                    # 给用户重试机会
                    retry_result = await ctx.elicit(
                        "是否重新扫码？",
                        response_type=["重新扫码", "继续等待确认", "取消登录"]
                    )

                    if retry_result.action != "accept" or retry_result.data == "取消登录":
                        return json.dumps({
                            "status": "cancelled",
                            "message": "用户取消了登录流程"
                        }, ensure_ascii=False, indent=2)

                    if retry_result.data == "重新扫码":
                        state.reset_login()
                        continue

                # 扫码成功，退出内层循环
                break

            # 步骤4：等待用户在手机上确认
            await ctx.info("📱 请在Boss直聘APP上确认登录...")

            # 显示等待动画
            wait_messages = [
                "⏳ 等待确认中...",
                "🔄 正在等待用户确认...",
                "⌛ 请在手机上点击确认...",
                "🕐 等待确认登录..."
            ]

            login_success = False
            for i in range(60):  # 最多等待60秒
                message = wait_messages[i % len(wait_messages)]
                await ctx.info(f"{message} ({i+1}/60秒)")

                # 检查登录确认状态
                confirm_status_code = await BossZhipinAPI.check_login_confirmation(session, qr_id)

                if confirm_status_code == 200:
                    # 获取最终Cookie
                    cookie_str, bst_value = await BossZhipinAPI.get_final_cookie(session, qr_id)

                    state.update_login_status(
                        is_logged_in=True,
                        cookie=cookie_str,
                        bst=bst_value,
                        login_step="logged_in"
                    )

                    confirm_result = {
                        "status": "logged_in",
                        "message": "登录成功！",
                        "has_cookie": True,
                        "has_bst": True,
                        "login_step": "logged_in"
                    }

                    await ctx.info("🎉 登录成功！")
                    return json.dumps(confirm_result, ensure_ascii=False, indent=2)
                elif confirm_status_code == 409:
                    await asyncio.sleep(1)
                    continue
                elif confirm_status_code == 408:
                    confirm_result = {"status": "timeout", "message": "登录确认超时"}
                else:
                    confirm_result = {"status": "error", "message": f"未知确认状态: {confirm_status_code}"}

                if confirm_result["status"] in ["timeout", "error"]:
                    await ctx.error(f"❌ {confirm_result['message']}")

                    # 询问用户是否重试
                    retry_result = await ctx.elicit(
                        f"登录失败: {confirm_result['message']}。是否重新开始登录？",
                        response_type=["重新登录", "取消"]
                    )

                    if retry_result.action == "accept" and retry_result.data == "重新登录":
                        # 重置状态并重新开始外层循环
                        state.reset_login()
                        await ctx.info("重新开始登录流程...")
                        break  # 退出当前确认等待，重新开始整个流程
                    else:
                        return json.dumps({
                            "status": "cancelled",
                            "message": "用户选择不重试登录"
                        }, ensure_ascii=False, indent=2)

            # 如果到达这里，说明登录超时
            if not login_success:
                await ctx.warning("⏰ 等待确认超时")
                timeout_result = await ctx.elicit(
                    "等待确认超时，是否重新开始登录？",
                    response_type=["重新登录", "取消"]
                )

                if timeout_result.action == "accept" and timeout_result.data == "重新登录":
                    # 重置状态并重新开始外层循环
                    state.reset_login()
                    await ctx.info("重新开始登录流程...")
                    continue  # 重新开始整个流程
                else:
                    return json.dumps({
                        "status": "timeout",
                        "message": "登录超时，用户选择不重试"
                    }, ensure_ascii=False, indent=2)

    except Exception as e:
        error_msg = f"交互式登录失败: {str(e)}"
        await ctx.error(error_msg)
        return json.dumps({
            "status": "error",
            "message": error_msg
        }, ensure_ascii=False, indent=2)


@mcp.tool()
async def get_login_info_tool(ctx: Context) -> str:
    """获取当前登录状态和Cookie信息的工具（主动检查状态）"""
    try:
        login_status = state.login_status

        # 如果有 qr_id 且未登录，主动检查 Boss API 状态
        if login_status.qr_id and not login_status.is_logged_in:
            qr_id = login_status.qr_id
            session = state.get_session()

            # 检查扫码状态
            scan_url = f"https://www.zhipin.com/wapi/zppassport/qrcode/scan?uuid={qr_id}"
            try:
                scan_resp = session.get(scan_url, timeout=5)
                if scan_resp.status_code == 200:
                    scan_data = scan_resp.json()
                    if scan_data.get("scaned"):
                        # 用户已扫码，更新状态
                        state.update_login_status(login_step="scanned")

                        # 检查确认状态
                        confirm_url = f"https://www.zhipin.com/wapi/zppassport/qrcode/scanLogin?qrId={qr_id}&status=1"
                        confirm_resp = session.get(confirm_url, timeout=5)
                        if confirm_resp.status_code == 200:
                            # 用户已确认登录，获取Cookie
                            import base64
                            from Crypto.Cipher import AES
                            from Crypto.Util.Padding import pad
                            from Crypto.Random import get_random_bytes

                            i_str = "8048b8676fb7d3d8952276e6e98e0bde.f2dc7a63c4b0fbfa4b51a07e2710cf83.fef7e750fc3a1e6327e8a880915aee9c.ae00f848beb1aa591d71d5a80dd3bd95"
                            e_b64 = "clRwXUJBK1VKK0k0IWFbbQ=="

                            key_bytes = base64.b64decode(e_b64)
                            plaintext_bytes = i_str.encode('utf-8')
                            iv_bytes = get_random_bytes(16)
                            cipher = AES.new(key_bytes, AES.MODE_CBC, iv_bytes)
                            padded_plaintext = pad(plaintext_bytes, AES.block_size)
                            ciphertext_bytes = cipher.encrypt(padded_plaintext)
                            result_bytes = iv_bytes + ciphertext_bytes
                            fp = base64.b64encode(result_bytes).decode('utf-8')

                            dispatcher_url = f"https://www.zhipin.com/wapi/zppassport/qrcode/dispatcher?qrId={qr_id}&pk=header-login&fp={fp}"
                            cookie_resp = session.get(dispatcher_url, allow_redirects=False)

                            set_cookie_headers = cookie_resp.headers.get('Set-Cookie', '')
                            cookie_str = ''
                            bst_value = ''

                            if set_cookie_headers:
                                cookies = {}
                                cookie_parts = set_cookie_headers.split(',')
                                for part in cookie_parts:
                                    if '=' in part:
                                        name_value = part.strip().split(';')[0].strip()
                                        if '=' in name_value:
                                            name, value = name_value.split('=', 1)
                                            cookies[name.strip()] = value.strip()

                                cookie_str = '; '.join([f"{k}={v}" for k, v in cookies.items()])
                                if 'bst' in cookies:
                                    bst_value = cookies['bst']

                            if cookie_str:
                                state.update_login_status(
                                    is_logged_in=True,
                                    cookie=cookie_str,
                                    bst=bst_value,
                                    login_step="logged_in"
                                )
                                await ctx.info("✅ 登录成功！Cookie已保存")
            except Exception as e:
                await ctx.info(f"检查登录状态时出错: {str(e)}")

        # 重新获取最新状态
        login_status = state.login_status

        # 构建响应信息
        result = {
            "is_logged_in": login_status.is_logged_in,
            "login_step": login_status.login_step,
            "qr_id": login_status.qr_id,
            "image_url": login_status.image_url,
            "error_message": login_status.error_message
        }

        # 如果已登录，添加Cookie信息
        if login_status.is_logged_in:
            result["cookie"] = login_status.cookie
            result["bst"] = login_status.bst

            # 解析Cookie显示详细信息
            if login_status.cookie:
                cookies_dict = {}
                for cookie_pair in login_status.cookie.split('; '):
                    if '=' in cookie_pair:
                        name, value = cookie_pair.split('=', 1)
                        cookies_dict[name] = value
                result["cookies_detail"] = cookies_dict

            await ctx.info("✅ 已登录，Cookie信息已返回")
        else:
            await ctx.info(f"⏳ 当前状态: {login_status.login_step}")

        return json.dumps(result, ensure_ascii=False, indent=2)

    except Exception as e:
        error_msg = f"获取登录信息失败: {str(e)}"
        await ctx.error(error_msg)
        return json.dumps({
            "status": "error",
            "message": error_msg
        }, ensure_ascii=False, indent=2)


@mcp.tool()
async def get_recommend_jobs_tool(
    ctx: Context,
    page: int = 1,
    experience: str = "不限",
    job_type: str = "全职",
    salary: str = "不限"
) -> str:
    """获取推荐职位工具

    参数说明：
    - page: 页码，从1开始
    - experience: 工作经验，可选值：在校生、应届生、不限、一年以内、一到三年、三到五年、五到十年、十年以上
    - job_type: 工作类型，可选值：全职、兼职
    - salary: 薪资范围，可选值：3k以下、3-5k、5-10k、10-20k、20-50k、50以上
    """
    await ctx.info(f"调用获取推荐职位工具: 页码{page}")

    try:
        if not state.login_status.is_logged_in:
            return json.dumps({
                "error": "未登录",
                "message": "请先完成登录再获取职位信息"
            }, ensure_ascii=False, indent=2)

        await ctx.info(f"获取推荐职位: 页码{page}, 经验{experience}, 类型{job_type}, 薪资{salary}")

        # 获取session并设置API请求头
        session = state.get_session()
        BossZhipinAPI.setup_api_headers(session, state.login_status.cookie, state.login_status.bst)

        # 构造API参数
        params = {
            "page": page,
            "experience": experience,
            "jobType": job_type,
            "salary": salary
        }

        # 调用真实的API
        result = await BossZhipinAPI.get_job_list(session, params)

        if result["status"] == "success":
            await ctx.info(f"成功获取 {result['data']['total']} 个职位")
            return json.dumps(result, ensure_ascii=False, indent=2)
        else:
            await ctx.error(f"获取职位失败: {result['message']}")
            return json.dumps({
                "error": "获取职位失败",
                "message": result["message"]
            }, ensure_ascii=False, indent=2)

    except Exception as e:
        error_msg = f"获取职位失败: {str(e)}"
        await ctx.error(error_msg)
        return json.dumps({
            "error": "获取职位失败",
            "message": error_msg
        }, ensure_ascii=False, indent=2)


@mcp.tool()
async def search_jobs(
    ctx: Context,
    keyword: str = "",
    city: str = "",
    salaryRange: str = "",
    experience: str = "",
    education: str = "",
    page: int = 1,
    pageSize: int = 20,
    sortBy: str = "default"
) -> str:
    """搜索职位工具

    参数说明：
    - keyword: 搜索关键词，如职位名称或技能
    - city: 城市名称
    - salaryRange: 薪资范围，如 20-30K
    - experience: 工作经验要求
    - education: 学历要求
    - page: 页码，从1开始
    - pageSize: 每页数量
    - sortBy: 排序方式
    """
    await ctx.info(f"搜索职位: 关键词={keyword}, 城市={city}, 页码={page}")

    try:
        if not state.login_status.is_logged_in:
            return json.dumps({
                "error": "未登录",
                "message": "请先完成登录再搜索职位",
                "jobs": [],
                "total": 0
            }, ensure_ascii=False, indent=2)

        # 获取session并设置API请求头
        session = state.get_session()
        BossZhipinAPI.setup_api_headers(session, state.login_status.cookie, state.login_status.bst)

        # 转换薪资范围格式
        salary = salaryRange if salaryRange else "不限"

        # 构造API参数 - 使用推荐职位接口
        params = {
            "page": page,
            "experience": experience if experience else "不限",
            "jobType": "全职",
            "salary": salary
        }

        # 调用API获取职位
        result = await BossZhipinAPI.get_job_list(session, params)

        if result.get("status") == "success":
            data = result.get("data", {})
            raw_jobs = data.get("jobs", [])

            # 转换为前端期望的格式
            jobs = []
            for job in raw_jobs:
                jobs.append({
                    "jobId": job.get("jobId", job.get("securityId", "")),
                    "securityId": job.get("securityId", job.get("security_id", "")),
                    "title": job.get("jobName", job.get("title", "未知职位")),
                    "jobName": job.get("jobName", job.get("title", "未知职位")),
                    "company": job.get("companyName", job.get("company", "未知公司")),
                    "companyName": job.get("companyName", job.get("company", "未知公司")),
                    "salary": job.get("salary", "面议"),
                    "salaryRange": job.get("salary", job.get("salaryRange", "面议")),
                    "city": job.get("city", city),
                    "location": job.get("city", job.get("location", "")),
                    "experience": job.get("experience", experience if experience else "不限"),
                    "education": job.get("education", education if education else "不限")
                })

            await ctx.info(f"成功搜索到 {len(jobs)} 个职位")

            return json.dumps({
                "status": "success",
                "jobs": jobs,
                "total": data.get("total", len(jobs)),
                "page": page,
                "pageSize": pageSize,
                "query": {
                    "keyword": keyword,
                    "city": city,
                    "salaryRange": salaryRange,
                    "experience": experience,
                    "education": education
                }
            }, ensure_ascii=False, indent=2)
        else:
            error_msg = result.get("message", "搜索职位失败")
            await ctx.error(f"搜索职位失败: {error_msg}")
            return json.dumps({
                "error": "搜索职位失败",
                "message": error_msg,
                "jobs": [],
                "total": 0
            }, ensure_ascii=False, indent=2)

    except Exception as e:
        error_msg = f"搜索职位失败: {str(e)}"
        await ctx.error(error_msg)
        return json.dumps({
            "error": "搜索职位失败",
            "message": error_msg,
            "jobs": [],
            "total": 0
        }, ensure_ascii=False, indent=2)


@mcp.tool()
async def send_greeting_tool(
    ctx: Context,
    security_id: str,
    job_id: str,
    message: str = "您好，我对这个职位很感兴趣，希望可以进一步沟通"
) -> str:
    """发送打招呼工具"""
    try:
        if not state.login_status.is_logged_in:
            return json.dumps({
                "error": "未登录",
                "message": "请先完成登录再发送打招呼"
            }, ensure_ascii=False, indent=2)

        await ctx.info(f"发送打招呼到职位 {job_id}")

        # 获取session并设置API请求头
        session = state.get_session()
        BossZhipinAPI.setup_api_headers(session, state.login_status.cookie, state.login_status.bst)

        # 调用真实的API
        result = await BossZhipinAPI.greet_boss(session, security_id, job_id)

        if result["status"] == "success":
            await ctx.info(f"打招呼发送成功: {job_id}")
            return json.dumps(result, ensure_ascii=False, indent=2)
        else:
            await ctx.error(f"发送打招呼失败: {result['message']}")
            return json.dumps({
                "error": "发送打招呼失败",
                "message": result["message"]
            }, ensure_ascii=False, indent=2)

    except Exception as e:
        error_msg = f"发送打招呼失败: {str(e)}"
        await ctx.error(error_msg)
        return json.dumps({
            "error": "发送打招呼失败",
            "message": error_msg
        }, ensure_ascii=False, indent=2)


# 主程序入口
if __name__ == "__main__":
    print("启动 Boss 直聘 MCP Server...")
    print("访问 http://127.0.0.1:8000/mcp 连接到MCP服务器")
    print("访问 http://127.0.0.1:8000/static/ 查看静态文件")

    # 运行FastMCP服务器
    mcp.run(transport="streamable-http")