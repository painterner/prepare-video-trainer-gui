#!/usr/bin/env python3
"""
视频链接安全性测试脚本
测试视频是否可以通过自动化工具下载
"""

import os
import time
import requests
from urllib.parse import unquote
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# 测试的视频URL
VIDEO_URL = "https://v3-web.douyinvod.com/6d0eeeaa4e8a5317d0ce33bb78c5a31f/6981449d/video/tos/cn/tos-cn-ve-15/oUp30ANAjoR0miE0MlifEBwddXLhHhIlenBzAS/?a=6383&ch=26&cr=3&dr=0&lr=all&cd=0%7C0%7C0%7C3&cv=1&br=1444&bt=1444&cs=0&ds=4&ft=AJkeU_TERR0si0C4kv12Nc0iPMgzbLa8Xm-U_4wMen_2Nv7TGW&mime_type=video_mp4&qs=0&rc=NzhnOjs5NDxlNTk8NjY8ZUBpandydG05cjw5NzMzbGkzNUAuM2A0Xy5hXy8xNjIzLjZeYSNkbmBmMmRjNGphLS1kLTVzcw%3D%3D&btag=80000e00030000&cquery=100z_100o_100w_100B_100x&dy_q=1770068002&feature_id=0ea98fd3bdc3c6c14a3d0804cc272721&l=202602030533222218E0D2C9E4E83BD8D6&__vid=7578543021525821541"

OUTPUT_DIR = "./downloads"

def test_direct_download():
    """测试1: 使用requests直接下载"""
    print("\n" + "="*60)
    print("测试1: 直接HTTP请求下载")
    print("="*60)
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.douyin.com/',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    }
    
    try:
        print(f"正在尝试下载...")
        response = requests.get(VIDEO_URL, headers=headers, stream=True, timeout=30)
        
        print(f"状态码: {response.status_code}")
        print(f"Content-Type: {response.headers.get('Content-Type', 'N/A')}")
        print(f"Content-Length: {response.headers.get('Content-Length', 'N/A')}")
        
        if response.status_code == 200:
            os.makedirs(OUTPUT_DIR, exist_ok=True)
            filepath = os.path.join(OUTPUT_DIR, "test_video_direct.mp4")
            
            total_size = 0
            with open(filepath, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
                        total_size += len(chunk)
            
            if total_size > 0:
                print(f"[漏洞] 直接下载成功! 文件大小: {total_size / 1024 / 1024:.2f} MB")
                print(f"保存路径: {filepath}")
                return True
            else:
                print("[安全] 下载内容为空")
                return False
        else:
            print(f"[安全] 下载失败，服务器返回: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"[异常] {str(e)}")
        return False


def test_selenium_download():
    """测试2: 使用Selenium模拟浏览器下载"""
    print("\n" + "="*60)
    print("测试2: Selenium浏览器自动化下载")
    print("="*60)
    
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    download_path = os.path.abspath(OUTPUT_DIR)
    
    options = Options()
    options.add_argument('--headless')  # 无头模式
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--disable-gpu')
    options.add_argument('--window-size=1920,1080')
    options.add_argument('user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
    
    # 设置下载目录
    prefs = {
        "download.default_directory": download_path,
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
        "safebrowsing.enabled": True
    }
    options.add_experimental_option("prefs", prefs)
    
    driver = None
    try:
        print("启动Chrome浏览器...")
        driver = webdriver.Chrome(options=options)
        driver.set_page_load_timeout(30)
        
        print(f"访问视频URL...")
        driver.get(VIDEO_URL)
        time.sleep(3)
        
        # 获取页面信息
        print(f"当前页面标题: {driver.title}")
        print(f"当前URL: {driver.current_url}")
        
        # 尝试查找视频元素
        video_elements = driver.find_elements(By.TAG_NAME, "video")
        print(f"找到 {len(video_elements)} 个video元素")
        
        for i, video in enumerate(video_elements):
            src = video.get_attribute("src")
            if src:
                print(f"  Video {i+1} src: {src[:100]}...")
        
        # 尝试通过JavaScript获取视频源
        print("\n尝试通过JavaScript提取视频源...")
        video_src = driver.execute_script("""
            var videos = document.getElementsByTagName('video');
            if (videos.length > 0) {
                return videos[0].src || videos[0].currentSrc;
            }
            return null;
        """)
        
        if video_src:
            print(f"[漏洞] 获取到视频源: {video_src[:100]}...")
            
            # 尝试下载这个视频源
            print("尝试下载获取到的视频源...")
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
            response = requests.get(video_src, headers=headers, stream=True, timeout=30)
            
            if response.status_code == 200:
                filepath = os.path.join(OUTPUT_DIR, "test_video_selenium.mp4")
                total_size = 0
                with open(filepath, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:
                            f.write(chunk)
                            total_size += len(chunk)
                
                if total_size > 0:
                    print(f"[漏洞] Selenium方式下载成功! 文件大小: {total_size / 1024 / 1024:.2f} MB")
                    return True
        
        # 检查网络请求中的视频
        print("\n检查网络请求...")
        logs = driver.execute_script("return window.performance.getEntries()")
        video_urls = [log['name'] for log in logs if 'video' in log.get('name', '').lower() or '.mp4' in log.get('name', '').lower()]
        
        if video_urls:
            print(f"[漏洞] 发现 {len(video_urls)} 个视频相关请求:")
            for url in video_urls[:5]:
                print(f"  - {url[:80]}...")
            return True
        
        print("[安全] 未能通过Selenium获取视频源")
        return False
        
    except Exception as e:
        print(f"[异常] {str(e)}")
        return False
    finally:
        if driver:
            driver.quit()


def test_curl_download():
    """测试3: 模拟curl下载"""
    print("\n" + "="*60)
    print("测试3: 模拟curl/wget下载")
    print("="*60)
    
    # 尝试不同的Referer和User-Agent组合
    test_cases = [
        {"name": "无Referer", "headers": {'User-Agent': 'curl/7.88.1'}},
        {"name": "抖音Referer", "headers": {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.douyin.com/'}},
        {"name": "空Referer", "headers": {'User-Agent': 'Mozilla/5.0', 'Referer': ''}},
    ]
    
    for case in test_cases:
        print(f"\n尝试: {case['name']}")
        try:
            response = requests.head(VIDEO_URL, headers=case['headers'], timeout=10, allow_redirects=True)
            print(f"  状态码: {response.status_code}")
            if response.status_code == 200:
                print(f"  [漏洞] 可以访问!")
            else:
                print(f"  [安全] 被拒绝")
        except Exception as e:
            print(f"  [异常] {str(e)}")


def main():
    print("="*60)
    print("视频链接安全性测试")
    print("="*60)
    print(f"测试URL: {VIDEO_URL[:80]}...")
    
    results = {}
    
    # 运行各项测试
    results['直接下载'] = test_direct_download()
    results['curl模拟'] = test_curl_download()
    
    try:
        results['Selenium'] = test_selenium_download()
    except Exception as e:
        print(f"\nSelenium测试跳过: {e}")
        results['Selenium'] = None
    
    # 汇总结果
    print("\n" + "="*60)
    print("测试结果汇总")
    print("="*60)
    
    for test_name, result in results.items():
        if result is True:
            status = "⚠️  漏洞 - 可被下载"
        elif result is False:
            status = "✅ 安全 - 无法下载"
        else:
            status = "❓ 未测试"
        print(f"{test_name}: {status}")
    
    # 检查下载的文件
    if os.path.exists(OUTPUT_DIR):
        files = os.listdir(OUTPUT_DIR)
        if files:
            print(f"\n下载的文件 ({OUTPUT_DIR}):")
            for f in files:
                filepath = os.path.join(OUTPUT_DIR, f)
                size = os.path.getsize(filepath)
                print(f"  - {f}: {size / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    main()
