// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract NoReturnToken {
    string public constant symbol = "NORETURN";
    uint8 public constant decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 value) external {
        balanceOf[to] += value;
    }

    function approve(address spender, uint256 value) external {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
    }

    function transfer(address to, uint256 value) external {
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
    }

    function transferFrom(address from, address to, uint256 value) external {
        allowance[from][msg.sender] -= value;
        balanceOf[from] -= value;
        balanceOf[to] += value;
    }
}

contract BlacklistToken is ERC20 {
    mapping(address => bool) public denied;

    constructor() ERC20("BLACKLIST", "BLACKLIST") {}

    function mint(address to, uint256 value) external {
        _mint(to, value);
    }

    function deny(address who, bool value) external {
        denied[who] = value;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!denied[from] && !denied[to], "blacklisted");
        super._update(from, to, value);
    }
}

contract DecreasingBalanceToken is ERC20 {
    constructor() ERC20("DECREASING", "DECREASING") {}

    function mint(address to, uint256 value) external {
        _mint(to, value);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (from != address(0) && to != address(0)) {
            super._update(to, address(0), balanceOf(to));
        }
    }
}
