import ctypes
import os

def get_cuda_memory():
    cudart_path = r"C:\Users\YOUR_USER\Desktop\The Stack\SOMA\.soma_venv\Lib\site-packages\torch\lib\cudart64_13.dll"
    if not os.path.exists(cudart_path):
        return None, None
    try:
        cudart = ctypes.CDLL(cudart_path)
        free = ctypes.c_size_t()
        total = ctypes.c_size_t()
        res = cudart.cudaMemGetInfo(ctypes.byref(free), ctypes.byref(total))
        if res == 0:
            return free.value // 1048576, total.value // 1048576
    except Exception as e:
        pass
    return None, None

if __name__ == '__main__':
    free, total = get_cuda_memory()
    print(f"CUDA Free: {free} MiB, Total: {total} MiB")
